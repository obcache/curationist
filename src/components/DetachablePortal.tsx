import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface DetachablePortalProps {
  name: string
  title: string
  width?: number
  height?: number
  onClose: () => void
  onWindowReady?: (win: Window | null) => void
  children: React.ReactNode
}

function syncStylesToPopout(sourceDoc: Document, targetDoc: Document) {
  const existing = Array.from(targetDoc.head.querySelectorAll('[data-curationist-cloned="1"]'))
  for (const node of existing) node.remove()

  for (const sheet of Array.from(sourceDoc.styleSheets)) {
    try {
      if (sheet.href) {
        const link = targetDoc.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        link.setAttribute('data-curationist-cloned', '1')
        targetDoc.head.appendChild(link)
      } else if (sheet.cssRules) {
        const style = targetDoc.createElement('style')
        style.setAttribute('data-curationist-cloned', '1')
        let cssText = ''
        for (const rule of Array.from(sheet.cssRules)) {
          cssText += `${rule.cssText}\n`
        }
        style.textContent = cssText
        targetDoc.head.appendChild(style)
      }
    } catch {
      // Cross-origin stylesheet fallback
      if (sheet.href) {
        const link = targetDoc.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        link.setAttribute('data-curationist-cloned', '1')
        targetDoc.head.appendChild(link)
      }
    }
  }
}

export const DetachablePortal: React.FC<DetachablePortalProps> = ({
  name,
  title,
  width = 720,
  height = 460,
  onClose,
  onWindowReady,
  children
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const winRef = useRef<Window | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onWindowReadyRef = useRef(onWindowReady)
  onWindowReadyRef.current = onWindowReady

  useEffect(() => {
    const features = `width=${Math.round(width)},height=${Math.round(height)},resizable=yes,scrollbars=no`
    const popout = window.open('', `curationist-popout:${name}`, features)
    if (!popout) {
      onCloseRef.current()
      return
    }
    winRef.current = popout
    popout.document.title = title
    popout.document.documentElement.style.height = '100%'
    popout.document.documentElement.style.background = '#111216'
    popout.document.body.style.margin = '0'
    popout.document.body.style.padding = '0'
    popout.document.body.style.height = '100%'
    popout.document.body.style.width = '100%'
    popout.document.body.style.overflow = 'hidden'
    popout.document.body.style.background = '#111216'
    popout.document.body.style.color = '#d4d8de'

    syncStylesToPopout(document, popout.document)

    const rootEl = popout.document.createElement('div')
    rootEl.id = 'curationist-popout-root'
    rootEl.style.width = '100%'
    rootEl.style.height = '100%'
    rootEl.style.display = 'flex'
    rootEl.style.flexDirection = 'column'
    rootEl.style.overflow = 'hidden'
    popout.document.body.innerHTML = ''
    popout.document.body.appendChild(rootEl)
    setContainer(rootEl)
    onWindowReadyRef.current?.(popout)

    let closedNotified = false
    const handleUnload = () => {
      if (closedNotified) return
      closedNotified = true
      winRef.current = null
      onWindowReadyRef.current?.(null)
      onCloseRef.current()
    }
    popout.addEventListener('beforeunload', handleUnload)

    // Fallback poll in case Electron closes the native window without firing beforeunload
    const closedCheck = window.setInterval(() => {
      if (popout.closed) {
        window.clearInterval(closedCheck)
        handleUnload()
      }
    }, 350)

    return () => {
      window.clearInterval(closedCheck)
      popout.removeEventListener('beforeunload', handleUnload)
      onWindowReadyRef.current?.(null)
      if (!popout.closed) {
        try {
          popout.close()
        } catch {
          // ignore
        }
      }
      winRef.current = null
    }
  }, [name])

  useEffect(() => {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.document.title = title
    }
  }, [title])

  if (!container) return null
  return createPortal(children, container)
}
