'use client'

import { useEffect, useRef, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const containerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const container = document.createElement('div')
    container.setAttribute('data-portal-root', 'true')
    document.body.appendChild(container)
    containerRef.current = container
    setMounted(true)

    return () => {
      if (containerRef.current && containerRef.current.parentNode) {
        containerRef.current.parentNode.removeChild(containerRef.current)
      }
      containerRef.current = null
    }
  }, [])

  if (!mounted || !containerRef.current) return null
  return createPortal(children, containerRef.current)
}