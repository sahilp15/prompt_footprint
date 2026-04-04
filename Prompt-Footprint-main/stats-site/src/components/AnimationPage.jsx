import { RefreshCw, Leaf } from 'lucide-react'
import { MeshGradient } from '@paper-design/shaders-react'
import { useWeeklyStats } from '../hooks/useStats'
import WaterTank from '../animations/WaterTank'
import LightBulb from '../animations/LightBulb'
import GasTank from '../animations/GasTank'
import { SplineScene } from './ui/splite'
import { Spotlight } from './ui/spotlight'
import './AnimationPage.css'

export default function AnimationPage() {
  const { data, loading, error } = useWeeklyStats()
  const totals = data?.totals || {}

  if (loading) return (
    <div className="page-loading">
      <div className="loading-leaf"><Leaf size={28} style={{ color: '#78A428' }} /></div>
      Loading your weekly impact...
    </div>
  )
  if (error) return <div className="page-error"><p>Could not connect to server.</p></div>

  return (
    <div className="anim-page">
      {/* Hero section with MeshGradient background + Spline 3D */}
      <div className="anim-hero">
        <MeshGradient
          className="anim-hero-gradient"
          colors={['#0A1A0A', '#4A6741', '#2D5A1B', '#6B8E23', '#1A2E10']}
          speed={0.25}
          backgroundColor="#0A120A"
        />
        <div className="anim-hero-spline">
          <SplineScene
            scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
            className="w-full h-full"
          />
        </div>
        <div className="anim-hero-content">
          <div className="anim-hero-badge">
            <Leaf size={14} />
            <span>Earth Impact Tracker</span>
          </div>
          <h1 className="anim-hero-title">Your Impact,<br />Visualized</h1>
          <p className="anim-hero-sub">
            Weekly environmental footprint of your AI usage — every prompt leaves a trace on our planet
          </p>
        </div>
      </div>

      {/* Animation cards */}
      <div className="anim-grid-section">
        <div className="anim-grid">
          <div className="anim-card-outer">
            <Spotlight className="-top-20 left-0" fill="#4AADB5" />
            <WaterTank waterMl={totals.totalWaterMl || 0} />
          </div>
          <div className="anim-card-outer">
            <Spotlight className="-top-20 left-0" fill="#D4A843" />
            <LightBulb energyWh={totals.totalEnergyWh || 0} />
          </div>
          <div className="anim-card-outer">
            <Spotlight className="-top-20 left-0" fill="#7A8C5A" />
            <GasTank co2G={totals.totalCo2G || 0} />
          </div>
        </div>
      </div>

      <div className="anim-footer">
        <RefreshCw size={14} />
        <span>Animations replay every time you open this page</span>
      </div>
    </div>
  )
}
