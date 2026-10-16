$projectRuntimeRoot = Split-Path $PSScriptRoot -Parent
$projectNodeDirectory = Join-Path $projectRuntimeRoot '.runtime\node'
$projectNpmDirectory = Join-Path $projectRuntimeRoot '.runtime\npm\node_modules\.bin'
if (!(Test-Path -LiteralPath (Join-Path $projectNodeDirectory 'node.exe')) -or !(Test-Path -LiteralPath (Join-Path $projectNpmDirectory 'npm.cmd'))) {
    throw 'Local runtime unavailable. Install Node.js >=22.12.0 with npm >=10 first.'
}
$env:Path = "$projectNodeDirectory;$projectNpmDirectory;$env:Path"
node --version
npm --version
