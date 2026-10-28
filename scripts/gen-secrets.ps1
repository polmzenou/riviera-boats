# Version PowerShell de gen-secrets.sh
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot '..\secrets'

Get-ChildItem -Path $dir -Filter '*.txt.example' | ForEach-Object {
    $target = Join-Path $dir ($_.Name -replace '\.example$', '')
    if (Test-Path $target) {
        Write-Host "existe deja : $(Split-Path $target -Leaf)"
        return
    }
    if ($_.Name -eq 'admin_password.txt.example') {
        $value = (Get-Content $_.FullName -Raw).Trim()
    } else {
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $value = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    }
    # sans BOM ni CRLF
    [System.IO.File]::WriteAllText($target, "$value`n")
    Write-Host "cree : $(Split-Path $target -Leaf)"
}
