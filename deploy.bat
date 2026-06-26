@echo off
cd /d "%~dp0"
echo Deploying WANHub to Vercel...
vercel --prod
echo.
echo Done.
pause
