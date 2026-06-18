#!/bin/bash

# 定义所有 git 命令及其描述
git_cmds=(
    "git pull"
    "git add ."
    "git commit -m 'update'"
    "git push"
    "git status"
)

# 依次执行 git 命令
git_failed=0
results[git]="成功"
for i in "${!git_cmds[@]}"; do
    cmd="${git_cmds[$i]}"
    eval "$cmd"
    status=$?
    if [ $status -ne 0 ]; then
        if [[ "$cmd" == "git pull" || "$cmd" == "git push" ]]; then
            echo "[失败] $cmd 执行失败"
            results[git]="$cmd 失败"
            git_failed=1
            break
        else
            echo "[警告] $cmd 执行失败，但继续执行后续命令"
            if [ -z "${results[git]}" ] || [ "${results[git]}" == "成功" ]; then
                results[git]="$cmd 失败(已忽略)"
            else
                results[git]="${results[git]}; $cmd 失败(已忽略)"
            fi
        fi
    fi
done

echo "git: ${results[git]}"

read -p "按任意键退出..."