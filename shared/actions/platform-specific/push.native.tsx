import * as Chat2Gen from '../chat2-gen'
import * as ConfigGen from '../config-gen'
import * as Constants from '../../constants/push'
import * as FsGen from '../fs-gen'
import * as Types from '../../constants/types/push'
import * as FsTypes from '../../constants/types/fs'
import * as NotificationsGen from '../notifications-gen'
import * as ProfileGen from '../profile-gen'
import * as PushGen from '../push-gen'
import * as RPCChatTypes from '../../constants/types/rpc-chat-gen'
import * as RPCTypes from '../../constants/types/rpc-gen'
import * as Saga from '../../util/saga'
import * as WaitingGen from '../waiting-gen'
import * as RouteTreeGen from '../route-tree-gen'
import * as Tabs from '../../constants/tabs'
import PushNotificationIOS from '@react-native-community/push-notification-ios'
import logger from '../../logger'
import {NativeModules, NativeEventEmitter, AppState} from 'react-native'
import {isIOS, isAndroid} from '../../constants/platform'
import * as Container from '../../util/container'

const clearLocalNotifications = () => {
  if (isIOS) {
    PushNotificationIOS.cancelAllLocalNotifications()
  } else {
    // TODO PUSH
  }
}

let lastCount = -1
const updateAppBadge = (_: Container.TypedState, action: NotificationsGen.ReceivedBadgeStatePayload) => {
  const count = (action.payload.badgeState.conversations || []).reduce(
    (total, c) => (c.badgeCounts ? total + c.badgeCounts[`${RPCTypes.DeviceType.mobile}`] : total),
    0
  )

  if (isIOS) {
    PushNotificationIOS.setApplicationIconBadgeNumber(count)
  } else {
    // TODO PUSH
  }
  // Only do this native call if the count actually changed, not over and over if its zero
  if (count === 0 && lastCount !== 0) {
    clearLocalNotifications()
  }
  lastCount = count
}

// Push notifications on android are simple.
// 1. KeybasePushNotificationListenerService.java is our listening service. (https://firebase.google.com/docs/cloud-messaging/android/receive)
// 2. When a notification comes in it is handled only on Go/Java side (native only)
// That's it.

// If you want to pass data along to JS, you do so with an Intent.
// The notification is built with a pending intent (a description of how to build a real Intent obj).
// When you click the notification you fire the Intent, which starts the MainActivity and calls `onNewIntent`.
// Take a look at MainActivity's onNewIntent, onResume, and emitIntent methods.
//
// High level:
// 1. we read the intent that started the MainActivity (in onNewIntent)
// 2. in `onResume` we check if we have an intent, if we do call `emitIntent`
// 3. `emitIntent` eventually calls `RCTDeviceEventEmitter` with a couple different event names for various events
// 4. We subscribe to those events below (e.g. `RNEmitter.addListener('initialIntentFromNotification', evt => {`)

// At startup the flow above can be racy, since we may not have registered the
// event listener before the event is emitted. In that case you can always use
// `getInitialPushAndroid`.
const listenForNativeAndroidIntentNotifications = async (
  emitter: (action: Container.TypedActions) => void
) => {
  const pushToken = await NativeModules.Utils.getRegistrationToken()
  logger.debug('[PushToken] received new token: ', pushToken)
  emitter(PushGen.createUpdatePushToken({token: pushToken}))

  const RNEmitter = new NativeEventEmitter(NativeModules.KeybaseEngine)
  RNEmitter.addListener('initialIntentFromNotification', evt => {
    const notification = evt && Constants.normalizePush(evt, true)
    notification && emitter(PushGen.createNotification({notification}))
  })

  // TODO: move this out of this file.
  // FIXME: sometimes this doubles up on a cold start--we've already executed the previous code.
  // TODO: fixme this is buggy. See: TRIAGE-462
  RNEmitter.addListener('onShareData', evt => {
    logger.debug('[ShareDataIntent]', evt)
    emitter(RouteTreeGen.createSwitchLoggedIn({loggedIn: true}))
    emitter(FsGen.createSetIncomingShareLocalPath({localPath: FsTypes.stringToLocalPath(evt.localPath)}))
    emitter(FsGen.createShowIncomingShare({initialDestinationParentPath: FsTypes.stringToPath('/keybase')}))
  })
  RNEmitter.addListener('onShareText', evt => {
    logger.debug('[ShareTextIntent]', evt)
    // TODO: implement
  })
}

const listenForPushNotificationsIOS = (emitter: (action: Container.TypedActions) => void) => {
  PushNotificationIOS.addEventListener('register', (token: {token: string}) => {
    logger.debug('[PushToken] received new token: ', token)
    emitter(PushGen.createUpdatePushToken({token: token.token}))
  })

  const onNotification = (n: Object) => {
    logger.debug('[onNotification]: ', n)
    const isBackground = AppState.currentState === 'background'
    const notification = Constants.normalizePush(n, isBackground)
    emitter(PushGen.createNotification({notification}))
  }
  PushNotificationIOS.addEventListener('notification', onNotification)
  PushNotificationIOS.addEventListener('localNotification', onNotification)
  PushNotificationIOS.addEventListener('registrationError', ({message, code, details}) =>
    logger.debug('[Push error]', message, code, details)
  )
}

function* setupPushEventLoop() {
  const pushChannel = yield Saga.eventChannel(emitter => {
    if (isAndroid) {
      listenForNativeAndroidIntentNotifications(emitter)
    } else {
      listenForPushNotificationsIOS(emitter)
    }

    // we never unsubscribe
    return () => {}
  }, Saga.buffers.expanding(10))

  while (true) {
    const action = yield Saga.take(pushChannel)
    yield Saga.put(action)
  }
}

const handleLoudMessage = async (notification: Types.PushNotification) => {
  if (notification.type !== 'chat.newmessage') {
    return false
  }
  // We only care if the user clicked while in session
  if (!notification.userInteraction) {
    return false
  }

  const {conversationIDKey, unboxPayload, membersType} = notification

  // immediately show the thread on top of the inbox w/o a nav
  const actions = [
    RouteTreeGen.createNavigateAppend({path: [{props: {conversationIDKey}, selected: 'chatConversation'}]}),
  ]

  if (unboxPayload && membersType && !isIOS) {
    logger.info('[Push] unboxing message')
    RPCChatTypes.localUnboxMobilePushNotificationRpcPromise({
      convID: conversationIDKey,
      membersType,
      payload: unboxPayload,
      shouldAck: false,
    }).catch(e => {
      logger.info('[Push] failed to unbox message form payload')
    })
  }

  return [
    RouteTreeGen.createClearModals(),
    RouteTreeGen.createResetStack({actions, index: 1, tab: 'tabs.chatTab'}),
    RouteTreeGen.createSwitchTab({tab: 'tabs.chatTab'}),
    Chat2Gen.createSelectConversation({conversationIDKey, reason: 'push'}),
  ]
}

// on iOS the go side handles a lot of push details
const handlePush = async (state: Container.TypedState, action: PushGen.NotificationPayload) => {
  try {
    const notification = action.payload.notification
    logger.info('[Push]: ' + notification.type || 'unknown')

    switch (notification.type) {
      case 'chat.readmessage':
        logger.info('[Push] read message')
        if (notification.badges === 0) {
          clearLocalNotifications()
        }
        break
      case 'chat.newmessageSilent_2':
        // entirely handled by go on ios and in onNotification on Android
        break
      case 'chat.newmessage':
        return await handleLoudMessage(notification)
      case 'follow':
        // We only care if the user clicked while in session
        if (notification.userInteraction) {
          const {username} = notification
          logger.info('[Push] follower: ', username)
          return ProfileGen.createShowUserProfile({username})
        }
        break
      case 'chat.extension': {
        const {conversationIDKey} = notification
        return Chat2Gen.createSelectConversation({conversationIDKey, reason: 'extension'})
      }
      case 'settings.contacts':
        if (state.config.loggedIn) {
          return [
            RouteTreeGen.createSwitchTab({tab: Tabs.peopleTab}),
            RouteTreeGen.createNavUpToScreen({routeName: 'peopleRoot'}),
          ]
        }
        break
    }
  } catch (e) {
    if (__DEV__) {
      console.error(e)
    }

    logger.error('[Push] unhandled!!')
  }
}

const uploadPushToken = async (state: Container.TypedState) => {
  const {config, push} = state
  const {deviceID} = config
  if (!config.username || !deviceID) {
    return false as const
  }
  const {token} = push
  if (!token) {
    return false as const
  }
  try {
    await RPCTypes.apiserverPostRpcPromise({
      args: [
        {key: 'push_token', value: token},
        {key: 'device_id', value: deviceID},
        {key: 'token_type', value: Constants.tokenType},
      ],
      endpoint: 'device/push_token',
    })

    logger.info('[PushToken] Uploaded to server')
  } catch (e) {
    logger.error("[PushToken] Couldn't save a push token", e)
  }
  return false as const
}

function* deletePushToken(state: Container.TypedState, action: ConfigGen.LogoutHandshakePayload) {
  const waitKey = 'push:deleteToken'
  yield Saga.put(
    ConfigGen.createLogoutHandshakeWait({increment: true, name: waitKey, version: action.payload.version})
  )

  try {
    const deviceID = state.config.deviceID
    if (!deviceID) {
      logger.info('[PushToken] no device id')
      return
    }

    yield RPCTypes.apiserverDeleteRpcPromise({
      args: [
        {key: 'device_id', value: deviceID},
        {key: 'token_type', value: Constants.tokenType},
      ],
      endpoint: 'device/push_token',
    })
    logger.info('[PushToken] deleted from server')
  } catch (e) {
    logger.error('[PushToken] delete failed', e)
  } finally {
    yield Saga.put(
      ConfigGen.createLogoutHandshakeWait({
        increment: false,
        name: waitKey,
        version: action.payload.version,
      })
    )
  }
}

const requestPermissionsFromNative = () =>
  isIOS ? PushNotificationIOS.requestPermissions() : Promise.resolve()
const askNativeIfSystemPushPromptHasBeenShown = () =>
  isIOS ? NativeModules.PushPrompt.getHasShownPushPrompt() : Promise.resolve(false)
const checkPermissionsFromNative = () =>
  isIOS ? new Promise(resolve => PushNotificationIOS.checkPermissions(resolve)) : Promise.resolve() // TODO PUSH
const monsterStorageKey = 'shownMonsterPushPrompt'

const neverShowMonsterAgain = async (state: Container.TypedState) => {
  if (!state.push.showPushPrompt) {
    await RPCTypes.configGuiSetValueRpcPromise({
      path: `ui.${monsterStorageKey}`,
      value: {b: true, isNull: false},
    })
  }
}

function* requestPermissions() {
  if (isIOS) {
    const shownPushPrompt = yield askNativeIfSystemPushPromptHasBeenShown()
    if (shownPushPrompt) {
      // we've already shown the prompt, take them to settings
      yield Saga.put(ConfigGen.createOpenAppSettings())
      yield Saga.put(PushGen.createShowPermissionsPrompt({show: false}))
      return
    }
  }
  try {
    yield Saga.put(WaitingGen.createIncrementWaiting({key: Constants.permissionsRequestingWaitingKey}))
    logger.info('[PushRequesting] asking native')
    const permissions = yield requestPermissionsFromNative()
    logger.info('[PushRequesting] after prompt:', permissions)
    if (permissions && (permissions.alert || permissions.badge)) {
      logger.info('[PushRequesting] enabled')
      yield Saga.put(PushGen.createUpdateHasPermissions({hasPermissions: true}))
    } else {
      logger.info('[PushRequesting] disabled')
      yield Saga.put(PushGen.createUpdateHasPermissions({hasPermissions: false}))
    }
  } finally {
    yield Saga.put(WaitingGen.createDecrementWaiting({key: Constants.permissionsRequestingWaitingKey}))
    yield Saga.put(PushGen.createShowPermissionsPrompt({show: false}))
  }
}

function* initialPermissionsCheck() {
  const hasPermissions = yield _checkPermissions(null)
  if (hasPermissions) {
    // Get the token
    yield Saga.spawn(requestPermissionsFromNative)
  } else {
    const shownNativePushPromptTask = yield Saga._fork(askNativeIfSystemPushPromptHasBeenShown)
    const shownMonsterPushPromptTask = yield Saga._fork(async () => {
      try {
        const v = await RPCTypes.configGuiGetValueRpcPromise({path: `ui.${monsterStorageKey}`})
        return !!v.b
      } catch (_) {
        return false
      }
    })
    const [shownNativePushPrompt, shownMonsterPushPrompt] = yield Saga.join([
      shownNativePushPromptTask,
      shownMonsterPushPromptTask,
    ])
    logger.info(
      '[PushInitialCheck] shownNativePushPrompt:',
      shownNativePushPrompt,
      'shownMonsterPushPrompt:',
      shownMonsterPushPrompt
    )
    if (!shownNativePushPrompt && !shownMonsterPushPrompt) {
      logger.info('[PushInitialCheck] no permissions, never shown prompt, now show prompt')
      yield Saga.put(PushGen.createShowPermissionsPrompt({show: true}))
    }
  }
}

function* checkPermissions(_: Container.TypedState, action: ConfigGen.MobileAppStatePayload) {
  yield* _checkPermissions(action)
}
// Call when we foreground and on app start, action is null on app start. Returns if you have permissions
function* _checkPermissions(action: ConfigGen.MobileAppStatePayload | null) {
  // Only recheck on foreground, not background
  if (action && action.payload.nextAppState !== 'active') {
    logger.info('[PushCheck] skip on backgrounding')
    return false
  }

  logger.debug(`[PushCheck] checking ${action ? 'on foreground' : 'on startup'}`)
  const permissions = yield checkPermissionsFromNative()
  if (permissions.alert || permissions.badge) {
    const state: Container.TypedState = yield* Saga.selectState()
    if (!state.push.hasPermissions) {
      logger.info('[PushCheck] enabled: getting token')
      yield Saga.put(PushGen.createUpdateHasPermissions({hasPermissions: true}))
      yield requestPermissionsFromNative()
    } else {
      logger.info('[PushCheck] enabled already')
    }
    return true
  } else {
    logger.info('[PushCheck] disabled')
    yield Saga.put(PushGen.createUpdateHasPermissions({hasPermissions: false}))
    return false
  }
}

function* getStartupDetailsFromInitialPush() {
  const {push, pushTimeout}: {push: PushGen.NotificationPayload; pushTimeout: boolean} = yield Saga.race({
    push: getInitialPush(),
    pushTimeout: Saga.delay(10),
  })
  if (pushTimeout || !push) {
    return null
  }

  const notification = push.payload.notification
  if (notification.type === 'follow') {
    if (notification.username) {
      return {startupFollowUser: notification.username}
    }
  } else if (notification.type === 'chat.newmessage' || notification.type === 'chat.newmessageSilent_2') {
    if (notification.conversationIDKey) {
      return {startupConversation: notification.conversationIDKey}
    }
  }

  return null
}

const getInitialPush = async () => {
  let n: any
  if (isAndroid) {
    n = await NativeModules.KeybaseEngine.getInitialIntent()
  } else {
    n = await PushNotificationIOS.getInitialNotification()
  }
  const notification = n && Constants.normalizePush(n, true)
  return notification && PushGen.createNotification({notification})
}

function* pushSaga() {
  // Permissions
  yield* Saga.chainGenerator<PushGen.RequestPermissionsPayload>(
    PushGen.requestPermissions,
    requestPermissions
  )
  yield* Saga.chainAction2([PushGen.showPermissionsPrompt, PushGen.rejectPermissions], neverShowMonsterAgain)
  yield* Saga.chainGenerator<ConfigGen.MobileAppStatePayload>(ConfigGen.mobileAppState, checkPermissions)

  // Token handling
  yield* Saga.chainAction2([PushGen.updatePushToken, ConfigGen.bootstrapStatusLoaded], uploadPushToken)
  yield* Saga.chainGenerator<ConfigGen.LogoutHandshakePayload>(ConfigGen.logoutHandshake, deletePushToken)

  yield* Saga.chainAction2(NotificationsGen.receivedBadgeState, updateAppBadge)
  yield* Saga.chainAction2(PushGen.notification, handlePush)
  yield* Saga.chainGenerator<ConfigGen.DaemonHandshakePayload>(ConfigGen.daemonHandshake, setupPushEventLoop)
  yield Saga.spawn(initialPermissionsCheck)
}

export default pushSaga
export {getStartupDetailsFromInitialPush}
