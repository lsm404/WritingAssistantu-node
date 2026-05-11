#!/bin/bash

# 将打包好的文件传输到服务器 49.235.172.63 的 /node-backend/ 目录下
# 如果你需要用到特定的 .pem 密钥文件登录，请在 scp 后面加上 -i 你的密钥Min@6678038路径，例如：
# scp -i /path/to/key.pem node-backend.tar root@49.235.172.63:/node-backend/

scp node-backend.tar root@49.235.172.63:/node-backend/
