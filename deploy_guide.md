# Инструкция по деплою на Aeza (176.98.176.27)

### 1. Подключение и подготовка (в PowerShell)
Зайди на сервер (пароль спросят после команды):
```powershell
ssh root@176.98.176.27
```
*(Когда спросят "Are you sure...", напиши `yes`. Затем вставь пароль).*

Выполни на сервере эти команды (установка Node.js и PM2):
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### 2. Копирование файлов (в новом окне PowerShell на ПК)
Открой **второе** окно PowerShell на своем компьютере в папке проекта и выполни:
```powershell
scp -r ./server/* root@176.98.176.27:~/server
```
*(Снова спросит пароль).*

### 3. Запуск сервера (в окне SSH)
Вернись в первое окно (где SSH) и запусти сервер:
```bash
cd ~/server
npm install
pm2 start index.js --name "streamlume-api"
pm2 save
pm2 startup
```

### 4. Открытие портов
На сервере выполни:
```bash
sudo ufw allow 3000
```

---
**Готово!** Сервер будет доступен по адресу `http://176.98.176.27:3000/api/verify`.
Не забудь вписать ключи Фрикассы в файл `.env` на своем компьютере перед выполнением команды `scp`.
