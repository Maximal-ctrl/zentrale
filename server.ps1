# Kleiner lokaler Webserver: liefert die Dateien aus diesem Ordner unter http://localhost:8080 aus.
param([int]$Port = 8080)

$root = $PSScriptRoot
$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.avif' = 'image/avif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
}

# Ordner mit den Hintergrundbildern: Hintergruende\Naturhintergruende
# (ue jeweils als Zeichencode geschrieben, damit diese Datei reines ASCII bleibt)
$backgroundsDir = Join-Path $root "Hintergr$([char]0xFC)nde\Naturhintergr$([char]0xFC)nde"
$imageExtensions = @('.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif')

# Liefert ["bild1.jpg", "bild2.png", ...] mit allen Bildern im Ordner
function Get-BackgroundList {
  $images = @()
  if (Test-Path -LiteralPath $backgroundsDir -PathType Container) {
    $images = @(Get-ChildItem -LiteralPath $backgroundsDir -File |
      Where-Object { $imageExtensions -contains $_.Extension.ToLower() } |
      Sort-Object Name |
      ForEach-Object { $_.Name })
  }
  if ($images.Count -eq 0) { return '[]' }
  return ConvertTo-Json -InputObject $images -Compress
}

# Gespeicherte Daten: Adresse -> Datei und Inhalt, solange die Datei noch nicht existiert
$jsonStores = @{
  'api/termine'       = @{ File = (Join-Path $root 'termine.json');       Empty = '[]' }
  'api/einstellungen' = @{ File = (Join-Path $root 'einstellungen.json'); Empty = '{}' }
  'api/ideen'         = @{ File = (Join-Path $root 'ideen.json');         Empty = '{"folders":[],"ideas":[]}' }
  'api/gewohnheiten'  = @{ File = (Join-Path $root 'gewohnheiten.json');  Empty = '{"habits":[]}' }
  # Gespeicherte Video-Links (Standard) sowie Accounts + Filter fuer den optionalen Live-Abruf
  'api/motivation'    = @{ File = (Join-Path $root 'motivation.json');    Empty = '{"videos":[],"accounts":[],"filter":true}' }
}
$utf8NoBom = New-Object Text.UTF8Encoding $false

# Diese Dateien werden nie an den Browser ausgeliefert
# (openai.json: alter API-Schluessel aus dem frueheren KI-Modus, falls die Datei noch im Ordner liegt;
#  instagram.json: Zugangsschluessel fuer Instagram)
$privateFiles = @('server.ps1', 'openai.json', 'instagram.json', 'instagram.vorlage.json')
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# ---------- Motivationsvideos live von Instagram (Business Discovery der Graph API) ----------
# Bei jedem Klick auf "Ich brauche Motivation" werden die neuesten Videos eines ausgewaehlten
# Accounts abgerufen und eins davon zurueckgegeben. Es wird nichts zwischengespeichert.
$instagramFile = Join-Path $root 'instagram.json'
$motivationFile = Join-Path $root 'motivation.json'
$script:igAccount = $null   # eigenes Instagram-Profikonto (wird einmal ermittelt, nur im Arbeitsspeicher)
# Woerter in Beschreibung/Hashtags, an denen ein Motivationsvideo erkannt wird (Umlaute als "." geschrieben)
$motivationPattern = 'motivat|mindset|disziplin|discipline|grind|hustle|erfolg|success|goal|ziel|dream|tr.um|nevergiveup|aufgeben|inspir|fokus|focus|selbstvertrauen|durchhalten|energie|energy|champion|winner|st.rke|strength|mentalit|believe|glaub an|keep going|weitermachen|ehrgeiz|ambition'

# TikTok-Kurzlinks (vm.tiktok.com/..., tiktok.com/t/...) zum vollen Video-Link aufloesen.
# Nur diese Adressen sind erlaubt; den Weiterleitungen wird hoechstens 5-mal gefolgt.
$shortLinkPattern = '^https?://((vm|vt)\.tiktok\.com|(www\.)?tiktok\.com/t)/[A-Za-z0-9]+/?$'
function Resolve-ShortLink($url) {
  if ($url -notmatch $shortLinkPattern) { throw 'Nur TikTok-Kurzlinks koennen aufgeloest werden.' }
  for ($i = 0; $i -lt 5; $i++) {
    $request = [Net.HttpWebRequest]::Create($url)
    $request.AllowAutoRedirect = $false
    $request.Method = 'GET'
    $request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
    $request.Timeout = 10000
    try {
      $answer = $request.GetResponse()
    } catch [Net.WebException] {
      $answer = $_.Exception.Response
      if (-not $answer) { throw }
    }
    $status = [int]$answer.StatusCode
    $location = $answer.Headers['Location']
    $answer.Close()
    if ($status -lt 300 -or $status -ge 400 -or -not $location) { return $url }
    $url = (New-Object Uri((New-Object Uri $url), $location)).AbsoluteUri
    if ($url -match 'tiktok\.com/@[^/]+/video/\d+') { return $url }
  }
  return $url
}

function Get-InstagramConfig {
  if (-not (Test-Path -LiteralPath $instagramFile -PathType Leaf)) { return $null }
  try {
    $config = [IO.File]::ReadAllText($instagramFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
  } catch {
    return $null
  }
  $token = [string]$config.accessToken
  if (-not $token -or $token -like '*HIER*' -or $token.Length -lt 20) { return $null }
  $version = if ($config.apiVersion) { [string]$config.apiVersion } else { 'v25.0' }
  return @{ Token = $token.Trim(); UserId = [string]$config.igUserId; Version = $version }
}

function Get-GraphErrorMessage($errorRecord) {
  $message = $errorRecord.Exception.Message
  if ($errorRecord.ErrorDetails -and $errorRecord.ErrorDetails.Message) {
    try { $message = ($errorRecord.ErrorDetails.Message | ConvertFrom-Json).error.message } catch { $message = $errorRecord.ErrorDetails.Message }
  }
  return $message
}

function Invoke-Graph($config, $graphPath, $fields) {
  $url = "https://graph.facebook.com/$($config.Version)/$graphPath" +
    "?fields=$([Uri]::EscapeDataString($fields))&access_token=$([Uri]::EscapeDataString($config.Token))"
  return Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 20
}

# Eigenes Instagram-Profikonto: aus instagram.json (igUserId) oder ueber die verknuepfte Facebook-Seite
function Get-InstagramAccount($config) {
  if ($script:igAccount) { return $script:igAccount }
  if ($config.UserId) {
    $script:igAccount = @{ Id = $config.UserId; Username = '' }
    return $script:igAccount
  }
  $pages = Invoke-Graph $config 'me/accounts' 'name,instagram_business_account{id,username}'
  foreach ($page in @($pages.data)) {
    if ($page.instagram_business_account) {
      $script:igAccount = @{ Id = [string]$page.instagram_business_account.id; Username = [string]$page.instagram_business_account.username }
      return $script:igAccount
    }
  }
  throw 'Kein Instagram-Profikonto gefunden. Ist dein Instagram-Konto ein Creator-/Business-Konto und mit einer Facebook-Seite verknuepft?'
}

function Get-MotivationStatus {
  $config = Get-InstagramConfig
  if (-not $config) { return @{ configured = $false } }
  try {
    $account = Get-InstagramAccount $config
    return @{ configured = $true; username = $account.Username }
  } catch {
    return @{ configured = $true; error = (Get-GraphErrorMessage $_) }
  }
}

# Ein zufaelliges Video eines zufaelligen ausgewaehlten Accounts - live abgerufen
function Get-LiveMotivationVideo($excludePermalink) {
  $config = Get-InstagramConfig
  if (-not $config) { return @{ Status = 400; Body = @{ error = 'not-configured' } } }
  $settings = if (Test-Path -LiteralPath $motivationFile -PathType Leaf) { [IO.File]::ReadAllText($motivationFile, [Text.Encoding]::UTF8) | ConvertFrom-Json } else { $null }
  $accounts = @($settings.accounts | ForEach-Object { [string]$_.username } | Where-Object { $_ })
  if ($accounts.Count -eq 0) { return @{ Status = 400; Body = @{ error = 'no-accounts' } } }
  $useFilter = -not ($settings -and $settings.filter -eq $false)

  try {
    $me = Get-InstagramAccount $config
  } catch {
    return @{ Status = 502; Body = @{ error = (Get-GraphErrorMessage $_) } }
  }

  $problems = @()
  $fallback = $null
  foreach ($username in ($accounts | Get-Random -Count $accounts.Count)) {
    try {
      $fields = "business_discovery.username($username){username,media.limit(40){caption,media_type,media_product_type,permalink}}"
      $result = Invoke-Graph $config $me.Id $fields
      $videos = @($result.business_discovery.media.data | Where-Object {
        ($_.media_type -eq 'VIDEO' -or $_.media_product_type -eq 'REELS') -and $_.permalink -and $_.permalink -ne $excludePermalink
      })
      if ($videos.Count -eq 0) { continue }
      $matching = @($videos | Where-Object { [string]$_.caption -match $motivationPattern })
      $pool = if ($useFilter -and $matching.Count -gt 0) { $matching } else { $videos }
      $pick = $pool | Get-Random
      $answer = @{
        permalink = [string]$pick.permalink
        account   = [string]$result.business_discovery.username
        caption   = ([string]$pick.caption -replace '\s+', ' ')
        matched   = ($matching.Count -gt 0)
      }
      if ($answer.caption.Length -gt 160) { $answer.caption = $answer.caption.Substring(0, 160) + '...' }
      # Mit Filter: einen Account ohne passendes Video nur nehmen, wenn kein anderer eins hat
      if ($useFilter -and $matching.Count -eq 0) {
        if (-not $fallback) { $fallback = $answer }
        continue
      }
      return @{ Status = 200; Body = $answer }
    } catch {
      $problems += "@$($username): $(Get-GraphErrorMessage $_)"
    }
  }
  if ($fallback) { return @{ Status = 200; Body = $fallback } }
  $message = if ($problems.Count) { $problems -join ' | ' } else { 'Bei deinen Accounts wurden gerade keine Videos gefunden.' }
  return @{ Status = 502; Body = @{ error = $message } }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Server laeuft auf http://localhost:$Port/  (Beenden mit Strg+C)"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path))

    $response = $context.Response
    try {
      if ($path -eq 'api/hintergruende') {
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        $bytes = [Text.Encoding]::UTF8.GetBytes((Get-BackgroundList))
      } elseif ($path -eq 'api/resolve-link') {
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        try {
          $resolved = Resolve-ShortLink ([string]$context.Request.QueryString['url'])
          $bytes = [Text.Encoding]::UTF8.GetBytes((@{ url = $resolved } | ConvertTo-Json -Compress))
        } catch {
          $response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress))
        }
      } elseif ($path -eq 'api/motivation/status') {
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        $bytes = [Text.Encoding]::UTF8.GetBytes((Get-MotivationStatus | ConvertTo-Json -Compress))
      } elseif ($path -eq 'api/motivation/live') {
        $live = Get-LiveMotivationVideo ([string]$context.Request.QueryString['exclude'])
        $response.StatusCode = $live.Status
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        $bytes = [Text.Encoding]::UTF8.GetBytes(($live.Body | ConvertTo-Json -Compress))
      } elseif ($path -eq 'hintergruende.json') {
        # Liste der Hintergrundbilder (online liegt dafuer eine feste hintergruende.json im Repo)
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        $bytes = [Text.Encoding]::UTF8.GetBytes((Get-BackgroundList))
      } elseif ($path -eq 'api/einrichtung' -and $context.Request.HttpMethod -eq 'POST') {
        # einrichtung.html: schreibt konto.js (Repo-Angaben + verschluesselte Schluessel)
        $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        if (-not $body.StartsWith('window.ZENTRALE_KONTO = ') -or $body.Length -gt 50000) { throw 'Ungueltige konto.js' }
        [IO.File]::WriteAllText((Join-Path $root 'konto.js'), $body, $utf8NoBom)
        $response.ContentType = 'application/json; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes('{"ok":true}')
      } elseif ($privateFiles -contains [IO.Path]::GetFileName($file).ToLower()) {
        $response.StatusCode = 403
        $response.ContentType = 'text/plain; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes('403 - Nicht erlaubt')
      } elseif ($jsonStores.ContainsKey($path)) {
        # Termine/Einstellungen liegen als JSON-Datei im Ordner; POST ersetzt den kompletten Inhalt
        $store = $jsonStores[$path]
        if ($context.Request.HttpMethod -eq 'POST') {
          $reader = New-Object IO.StreamReader($context.Request.InputStream, [Text.Encoding]::UTF8)
          $body = $reader.ReadToEnd()
          $reader.Close()
          $null = ConvertFrom-Json $body  # bricht bei ungueltigem JSON ab, bevor etwas ueberschrieben wird
          [IO.File]::WriteAllText($store.File, $body, $utf8NoBom)
        }
        $json = if (Test-Path -LiteralPath $store.File -PathType Leaf) { [IO.File]::ReadAllText($store.File, [Text.Encoding]::UTF8) } else { $store.Empty }
        $response.ContentType = 'application/json; charset=utf-8'
        $response.Headers.Add('Cache-Control', 'no-store')
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
      } elseif ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
        # Seite und Skripte immer frisch laden, damit Updates sofort ankommen
        if ($ext -eq '.html' -or $ext -eq '.js' -or $ext -eq '.css') { $response.Headers.Add('Cache-Control', 'no-cache') }
        $bytes = [IO.File]::ReadAllBytes($file)
      } else {
        $response.StatusCode = 404
        $response.ContentType = 'text/plain; charset=utf-8'
        $bytes = [Text.Encoding]::UTF8.GetBytes('404 - Nicht gefunden')
      }
      $response.ContentLength64 = $bytes.Length
      # HEAD-Anfragen bekommen nur die Kopfzeilen, keinen Inhalt
      if ($context.Request.HttpMethod -ne 'HEAD') {
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    } catch {
      Write-Host "Fehler bei /$path : $($_.Exception.Message)"
      try { $response.StatusCode = 500 } catch {}
    } finally {
      $response.Close()
    }
  }
} finally {
  $listener.Stop()
}
