#!/bin/bash

# 将当前目录的代码打包为 node-backend.tar，同时排除掉不需要的 node_modules 目录
tar -cvf node-backend.tar --exclude=node_modules --exclude=data --exclude=.git --exclude=.npm-cache .
