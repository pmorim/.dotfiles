[Console]::OutputEncoding = [Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()

$orca = "$env:USERPROFILE\.orca\agent-hooks\claude-statusline.cmd"
if (Test-Path $orca) {
    $tmp = New-TemporaryFile
    Set-Content -Path $tmp -Value $raw -NoNewline -Encoding utf8
    cmd /c "`"$orca`" < `"$tmp`"" | Out-Null
    Remove-Item $tmp -ErrorAction SilentlyContinue
}

$data = $raw | ConvertFrom-Json
$esc = [char]27
$dim = "$esc[2m"
$reset = "$esc[0m"

$model = $data.model.display_name
$effort = $data.effort.level
if (-not $effort) { $effort = $data.reasoning_effort }
$head = $model
if ($effort) { $head += " $([char]0x00B7) $effort" }

$cw = $data.context_window
$pct = [double]$cw.used_percentage
$u = $cw.current_usage
$tokens = if ($u) { [double]$u.input_tokens + [double]$u.cache_creation_input_tokens + [double]$u.cache_read_input_tokens } else { $pct * [double]$cw.context_window_size / 100 }

function Format-Tokens($n) {
    if ($n -ge 1000000) { return ("{0:0.#}M" -f ($n / 1000000)) }
    if ($n -ge 1000) { return ("{0:0}k" -f ($n / 1000)) }
    return [string][int]$n
}

$width = 20
$dumbZoneTokens = 250000
$filled = [math]::Min($width, [math]::Floor($tokens * $width / $dumbZoneTokens))
$bar = ([string][char]0x2588 * $filled) + "$dim$([string][char]0x2591 * ($width - $filled))$reset"

$sep = "$dim $([char]0x2502) $reset"
Write-Output "$head$sep$bar $(Format-Tokens $tokens) $dim/ $(Format-Tokens $dumbZoneTokens)$reset"
