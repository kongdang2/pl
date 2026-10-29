@echo off
chcp 65001 >nul
rem 소통 중계 시작: 이 창을 열어 두는 동안 웹 「소통」의 Codex·Claude 앞 대기 글을 자동 실행합니다. 끝내려면 창을 닫으세요.
title 소통 중계
cd /d "%~dp0.."
node "%~dp0중계.cjs"
pause
