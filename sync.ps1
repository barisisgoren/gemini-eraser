# Sync Script for Professional GitHub Uploads
# Usage: ./sync.ps1 "Your commit message"

$commitMessage = $args[0]
if (-not $commitMessage) {
    # Default professional commit message in English
    $commitMessage = "Refactor: project branding and repository isolation"
}

Write-Host "--- Professional Git Sync Started ---" -ForegroundColor Cyan

# 1. Add all changes
Write-Host "[1/4] Adding changes..." -ForegroundColor Gray
git add -A

# 2. Commit
Write-Host "[2/4] Committing changes: $commitMessage" -ForegroundColor Gray
git commit -m "$commitMessage"

# 3. Pull latest changes (professional rebase)
Write-Host "[3/4] Pulling latest changes from main..." -ForegroundColor Gray
git pull --rebase origin main

# 4. Push to GitHub
Write-Host "[4/4] Pushing to GitHub..." -ForegroundColor Green
git push origin main

Write-Host "--- Sync Completed Successfully ---" -ForegroundColor Cyan
