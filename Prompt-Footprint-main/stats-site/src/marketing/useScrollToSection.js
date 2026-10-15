import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

// In-page section navigation. HashRouter owns the URL hash, so plain "#id"
// anchors don't work, so we scroll imperatively instead. From another route
// (e.g. /privacy) we first return to the landing page, then scroll.
export function useScrollToSection() {
  const navigate = useNavigate()
  const location = useLocation()
  return (id) => {
    const scroll = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (location.pathname === '/') {
      scroll()
    } else {
      navigate('/')
      requestAnimationFrame(() => setTimeout(scroll, 60))
    }
  }
}

/**
 * HashRouter keeps the window's scroll position across routes, so a link from
 * the bottom of one page would land mid-way down the next. Reset it.
 */
export function useScrollTopOnRoute() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
}
