import { RefreshCw } from 'lucide-react'
import { useWeeklyStats } from '../hooks/useStats'
import WaterTank from '../animations/WaterTank'
import LightBulb from '../animations/LightBulb'
import GasTank from '../animations/GasTank'
import './AnimationPage.css'

export default function AnimationPage() {
  const { data, loading, error } = useWeeklyStats()
  const totals = data?.totals || {}

  if (loading) return <div className="page-loading">Loading your weekly data...</div>
  if (error) return <div className="page-error"><p>Could not connect to server.</p></div>

  return (
    <div className="anim-page">
      <div className="page-header">
        <h1 className="page-title">Your Impact, Visualized</h1>
        <p className="page-subtitle">Weekly environmental footprint of your AI usage — animations play each visit</p>
      </div>

      <div className="anim-grid">
        <WaterTank waterMl={totals.totalWaterMl || 0} />
        <LightBulb energyWh={totals.totalEnergyWh || 0} />
        <GasTank co2G={totals.totalCo2G || 0} />
      </div>

      <div className="anim-footer">
        <RefreshCw size={14} />
        <span>Animations replay every time you open this page</span>
      </div>
    </div>
  )
}
