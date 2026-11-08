@echo off
chcp 65001 >nul
rem Supabase Usage 값을 가져올 전용 브라우저에 로그인합니다(처음 한 번, 또는 웹 카드에 「다시 로그인 필요」가 뜰 때).
title Supabase 사용량 로그인
cd /d "%~dp0.."
node "%~dp0사용량로그인.cjs"
pause
