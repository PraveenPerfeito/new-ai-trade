export function analyticsWindowLabel(hours: number | null | undefined): string {
  if (hours == null) return 'Window pending'
  if (hours === 24) return 'Rolling 24h'
  if (hours === 168) return 'Rolling 7d'
  if (hours === 720) return 'Historical 30d'
  if (hours % 24 === 0) return `Rolling ${hours / 24}d`
  return `Rolling ${hours}h`
}

export function explicitWindowNote(hours: number | null | undefined): string {
  return `${analyticsWindowLabel(hours)} window`
}
