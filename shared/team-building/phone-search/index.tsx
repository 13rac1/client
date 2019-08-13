import * as React from 'react'
import * as Kb from '../../common-adapters/index'
import PhoneInput from "../../signup/phone-number/phone-input";
import {Avatar} from "../../common-adapters/index";
import * as Styles from '../../styles'
import * as RPCTypes from '../../constants/types/rpc-gen'
import {ProgressIndicator} from "../../common-adapters/index";
import {Box2} from "../../common-adapters/index";

type PhoneSearchProps = {
    onChangeNumber: (phoneNumber: string) => void
    assertionToContactMap: I.Map<string, RPCTypes.ProcessedContact>
    onContinue: (phoneNumberOrUsername: string) => void
}

let PhoneSearch = (props: PhoneSearchProps) => {
    const [validity, setValidity] = React.useState<boolean>(false)
    const [phoneNumber, setPhoneNumber] = React.useState<string>("")

    let user = props.assertionToContactMap.get(phoneNumber)

    let _onContinue = () => props.onContinue(user ? user.username : phoneNumber)

    return (
        <>
            <Kb.Box2 direction="vertical" gap="tiny" style={{backgroundColor: Styles.globalColors.greyLight, marginTop: Styles.globalMargins.tiny}}>
                <PhoneInput
                    autoFocus={true}
                    onChangeNumber={(p) => {props.onChangeNumber(p); setPhoneNumber(p)}}
                    onChangeValidity={setValidity}
                />
                {validity && !user && (
                    <Kb.ProgressIndicator type="Small" />
                )}
                {validity && !!user && (
                    <Kb.Box2 direction="horizontal" gap="tiny">
                        <Avatar size={48} username={user.username} showFollowingStatus={true} onClick={_onContinue} />
                        <Kb.Box2 direction="vertical">
                            <Kb.Text type="BodySemibold" style={{color: Styles.globalColors.green}} onClick={_onContinue}>
                                {user.username}
                            </Kb.Text>
                            <Kb.Text type="Body" onClick={_onContinue}>
                                {user.fullName}
                            </Kb.Text>
                        </Kb.Box2>
                    </Kb.Box2>
                    )}
            </Kb.Box2>
            {/*<Kb.Text type="Body" selectable={true}>*/}
            {/*    {"validity: " + JSON.stringify(validity)}*/}
            {/*    {"phonenumber: " + JSON.stringify(phoneNumber)}*/}
            {/*    {"map: " + JSON.stringify(props.assertionToContactMap)}*/}
            {/*    {"userinfo: " + JSON.stringify(user)}*/}
            {/*</Kb.Text>*/}
            <Kb.Box style={{flexDirection: 'column', flexGrow: 1, backgroundColor: Styles.globalColors.greyLight}} />
            <Kb.Button style={{flexGrow: 0}} fullWidth={true} onClick={_onContinue} label="Continue" disabled={!validity}/>
        </>
    )
}

export default PhoneSearch