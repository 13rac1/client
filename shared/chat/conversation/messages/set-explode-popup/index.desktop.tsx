import * as React from 'react'
import {MessageExplodeDescription} from '../../../../constants/types/chat2'
import * as Kb from '../../../../common-adapters'
import {platformStyles, globalColors} from '../../../../styles'
import {Props} from '.'

const quantityTextStyle = platformStyles({
  common: {
    textAlign: 'right',
    // NOTE if times are added that have three digits, this will need to be increased.
    width: 15,
  },
  isElectron: {display: 'inline-block'},
})

type ItemProps = {
  desc: MessageExplodeDescription
  selected: boolean
}

const Item = (props: ItemProps) => {
  let content: React.ReactNode
  const words = props.desc.text.split(' ')
  if (props.desc.seconds === 0) {
    // never item
    content = props.desc.text
  } else {
    content = (
      <>
        <Kb.Text type="Body" style={quantityTextStyle}>
          {words[0]}
        </Kb.Text>
        {' ' + words.slice(1).join(' ')}
      </>
    )
  }
  return (
    <Kb.Box2 direction="horizontal" fullWidth={true}>
      <Kb.Text type="Body" style={{flex: 1}}>
        {content}
      </Kb.Text>
      {props.selected && (
        <Kb.Icon type={Kb.Icon.makeFastType(Kb.IconType.iconfont_check)} color={globalColors.blue} />
      )}
    </Kb.Box2>
  )
}

const SetExplodePopup = (props: Props) => {
  const selected = props.selected || {seconds: 0, text: 'Never'}
  const listItems: Kb.MenuItems = props.items.map(it => ({
    disabled: false,
    onClick: () => props.onSelect(it.seconds),
    title: it.text,
    view: <Item desc={it} selected={selected === it.seconds} />,
  }))
  listItems.unshift({
    disabled: true,
    onClick: undefined,
    title: 'Explode message after:',
    view: <Kb.Text type="BodySmallSemibold">Explode messages after:</Kb.Text>,
  })
  return (
    <Kb.FloatingMenu
      attachTo={props.attachTo}
      position="top left"
      visible={props.visible}
      closeOnSelect={true}
      onHidden={props.onHidden}
      items={listItems}
      containerStyle={{
        bottom: 3,
        position: 'relative',
      }}
    />
  )
}

export default SetExplodePopup
