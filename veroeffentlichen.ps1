# Laedt die aktuelle Version der Zentrale auf GitHub hoch (GitHub Pages zeigt sie dann online an).
# Vorher wird die Liste der Hintergrundbilder (hintergruende.json) neu geschrieben.
param([string]$Message = 'Zentrale aktualisiert')

$root = $PSScriptRoot
Set-Location $root
$git = 'git'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $git = 'C:\Program Files\Git\cmd\git.exe' }

$backgroundsDir = Join-Path $root "Hintergr$([char]0xFC)nde\Naturhintergr$([char]0xFC)nde"
$imageExtensions = @('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif')
$images = @(Get-ChildItem -LiteralPath $backgroundsDir -File |
  Where-Object { $imageExtensions -contains $_.Extension.ToLower() } |
  Sort-Object Name | ForEach-Object { $_.Name })
$json = if ($images.Count) { ConvertTo-Json -InputObject $images -Compress } else { '[]' }
[IO.File]::WriteAllText((Join-Path $root 'hintergruende.json'), $json, (New-Object Text.UTF8Encoding $false))

& $git add -A
& $git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Keine Aenderungen zum Hochladen.'
} else {
  & $git commit -m $Message
}
& $git push
