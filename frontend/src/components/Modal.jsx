import { useEffect, useRef } from 'react'

export default function Modal({ children, onClose, title }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    const dialog = ref.current
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return <dialog ref={ref} className="detail-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}>
    {children}
  </dialog>
}
