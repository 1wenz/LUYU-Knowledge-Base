$projectRuntimeRoot = Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath (Join-Path $projectRuntimeRoot '.runtime\node\node.exe'))) {
    $sharedGitDirectory = git -C $projectRuntimeRoot rev-parse --git-common-dir 2>$null
    if ($LASTEXITCODE -eq 0 -and $sharedGitDirectory) {
        if (![IO.Path]::IsPathRooted($sharedGitDirectory)) { $sharedGitDirectory = Join-Path $projectRuntimeRoot $sharedGitDirectory }
        $sharedGitDirectory = [IO.Path]::GetFullPath($sharedGitDirectory)
        $sharedProjectRoot = Split-Path $sharedGitDirectory -Parent
        if (Test-Path -LiteralPath (Join-Path $sharedProjectRoot '.runtime\node\node.exe')) { $projectRuntimeRoot = $sharedProjectRoot }
    }
}
$projectNodeDirectory = Join-Path $projectRuntimeRoot '.runtime\node'
$projectNpmDirectory = Join-Path $projectRuntimeRoot '.runtime\npm\node_modules\.bin'
if (!(Test-Path -LiteralPath (Join-Path $projectNodeDirectory 'node.exe')) -or !(Test-Path -LiteralPath (Join-Path $projectNpmDirectory 'npm.cmd'))) {
    throw 'Local runtime unavailable. Install Node.js >=22.12.0 with npm >=10 first.'
}
$env:Path = "$projectNodeDirectory;$projectNpmDirectory;$env:Path"
node --version
npm --version
