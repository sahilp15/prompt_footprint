import { Suspense, lazy } from 'react'

const Spline = lazy(() => import('@splinetool/react-spline'))

export function SplineScene({ scene, className }) {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#78A428] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <Spline scene={scene} className={className} />
    </Suspense>
  )
}
