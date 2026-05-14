#!/usr/bin/env bash

# pull.sh - Pull (or use local) image and deploy a Memos container.

set -Eeuo pipefail
IFS=$'\n\t'

cd "$(dirname "$0")"

usage() {
    cat <<'EOF'
Usage:
  ./pull.sh [--local] [--no-login] [--image IMAGE] [--name NAME] [tag]
  ./pull.sh true|false [tag]   # backwards-compatible proxy toggle; proxy is not used by this script

Environment (.env is supported for the allowlisted variables below):
  GITHUB_USERNAME       GHCR username when pulling a private image
  GITHUB_TOKEN          GHCR token with read:packages when pulling a private image
  IMAGE_NAME            Image name, default ghcr.io/austinhmh/memos
  MEMOS_DATA_DIR        Host data directory, default $HOME/.memos
  MEMOS_HOST_ADDR       Host bind address, default 127.0.0.1
  MEMOS_HOST_PORT       Host bind port, default 8081
  MEMOS_INSTANCE_URL    Optional public instance URL
EOF
}

die() {
    echo "错误: $*" >&2
    exit 1
}

load_env_file() {
    local env_file="$1"
    local line key value

    [ -f "$env_file" ] || return 0
    echo "加载 .env 配置文件（仅导入脚本允许的变量）..."

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|'#'*) continue ;;
            export\ *) line="${line#export }" ;;
        esac
        [[ "$line" == *=* ]] || continue
        key="${line%%=*}"
        value="${line#*=}"
        key="${key//[[:space:]]/}"
        value="${value#${value%%[![:space:]]*}}"
        value="${value%${value##*[![:space:]]}}"
        if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
            value="${value:1:${#value}-2}"
        elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
            value="${value:1:${#value}-2}"
        fi

        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die ".env 中存在非法变量名: $key"
        case "$key" in
            GITHUB_USERNAME|GITHUB_TOKEN|IMAGE_NAME|MEMOS_DATA_DIR|MEMOS_HOST_ADDR|MEMOS_HOST_PORT|MEMOS_INSTANCE_URL)
                if [ -z "${!key+x}" ]; then
                    export "$key=$value"
                fi
                ;;
            *)
                echo "  忽略 .env 中未允许的变量: $key"
                ;;
        esac
    done < "$env_file"
}

validate_tag() {
    local tag="$1"
    [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "非法镜像标签: $tag"
}

validate_image_name() {
    local image="$1"
    [ -n "$image" ] || die "IMAGE_NAME 不能为空"
    [[ "$image" != -* ]] || die "IMAGE_NAME 不能以 '-' 开头"
    [[ ! "$image" =~ [[:space:][:cntrl:]\;\`\'\"\|\&\<\>\$] ]] || die "IMAGE_NAME 包含非法字符"
}

validate_container_name() {
    local name="$1"
    [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die "非法容器名称: $name"
}

validate_port() {
    local port="$1"
    [[ "$port" =~ ^[0-9]+$ ]] || die "非法端口: $port"
    [ "$port" -ge 1 ] && [ "$port" -le 65535 ] || die "端口超出范围: $port"
}

validate_host_addr() {
    local addr="$1"
    [[ "$addr" =~ ^[A-Za-z0-9_.:-]+$ ]] || die "非法监听地址: $addr"
}

validate_data_dir() {
    local dir="$1"
    [ -n "$dir" ] || die "MEMOS_DATA_DIR 不能为空"
    [[ "$dir" = /* ]] || die "MEMOS_DATA_DIR 必须是绝对路径: $dir"
    case "$dir" in
        /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/proc|/root|/run|/sbin|/sys|/usr|/var|/var/opt)
            die "拒绝将高风险系统目录挂载为数据目录: $dir"
            ;;
    esac
}

load_env_file ".env"

IMAGE_NAME="${IMAGE_NAME:-ghcr.io/austinhmh/memos}"
CONTAINER_NAME="memos"
LOCAL_ONLY=false
SKIP_LOGIN=false
VERSION_TAG="latest"
TAG_SET=false

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        --local)
            LOCAL_ONLY=true
            ;;
        --no-login)
            SKIP_LOGIN=true
            ;;
        --no-proxy|false|--proxy|true)
            echo "提示: pull.sh 不再使用代理参数，已忽略 $1"
            ;;
        --image)
            shift
            [ "$#" -gt 0 ] || die "--image 需要参数"
            IMAGE_NAME="$1"
            ;;
        --image=*)
            IMAGE_NAME="${1#--image=}"
            ;;
        --name)
            shift
            [ "$#" -gt 0 ] || die "--name 需要参数"
            CONTAINER_NAME="$1"
            ;;
        --name=*)
            CONTAINER_NAME="${1#--name=}"
            ;;
        --*)
            die "未知参数: $1"
            ;;
        *)
            if [ "$TAG_SET" = true ]; then
                die "只能指定一个镜像标签"
            fi
            VERSION_TAG="$1"
            TAG_SET=true
            ;;
    esac
    shift
done

validate_tag "$VERSION_TAG"
validate_image_name "$IMAGE_NAME"
validate_container_name "$CONTAINER_NAME"

DATA_DIR="${MEMOS_DATA_DIR:-$HOME/.memos}"
HOST_ADDR="${MEMOS_HOST_ADDR:-127.0.0.1}"
HOST_PORT="${MEMOS_HOST_PORT:-8081}"
validate_data_dir "$DATA_DIR"
validate_host_addr "$HOST_ADDR"
validate_port "$HOST_PORT"

if [ "$LOCAL_ONLY" = true ]; then
    RUN_IMAGE="memos:$VERSION_TAG"
else
    RUN_IMAGE="$IMAGE_NAME:$VERSION_TAG"
fi

cat <<EOF
==========================================
Memos 部署
==========================================
镜像来源: $([ "$LOCAL_ONLY" = true ] && echo "本地" || echo "远程仓库")
运行镜像: $RUN_IMAGE
容器名称: $CONTAINER_NAME
数据目录: $DATA_DIR
端口映射: $HOST_ADDR:$HOST_PORT:5230
==========================================
EOF

echo ""
echo "[ 1/4 ] 检查数据目录 ..."
if [ ! -d "$DATA_DIR" ]; then
    install -d -m 700 "$DATA_DIR"
    echo "  已创建: $DATA_DIR"
else
    echo "  已存在: $DATA_DIR"
fi

echo ""
if [ "$LOCAL_ONLY" = true ]; then
    echo "[ 2/4 ] 使用本地镜像 ..."
    if ! docker image inspect "$RUN_IMAGE" >/dev/null 2>&1; then
        die "本地镜像 $RUN_IMAGE 不存在，请先运行: ./build-push.sh --local $VERSION_TAG"
    fi
    echo "  本地镜像已确认: $RUN_IMAGE"
else
    echo "[ 2/4 ] 拉取远程镜像 ..."
    if [ "$SKIP_LOGIN" = false ] && [ -n "${GITHUB_USERNAME:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
        [[ "${GITHUB_TOKEN}" != ghp_replace* ]] || die "GITHUB_TOKEN 仍是示例占位值"
        printf '%s\n' "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USERNAME" --password-stdin
    else
        echo "  未提供登录凭证或已指定 --no-login，将直接尝试拉取公共镜像"
    fi
    docker pull "$RUN_IMAGE"
fi

echo ""
echo "[ 3/4 ] 替换旧容器 ..."
if [ -n "$(docker ps -aq -f "name=^${CONTAINER_NAME}$")" ]; then
    echo "  停止并删除旧容器 ..."
    docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

echo ""
echo "[ 4/4 ] 启动新容器 ..."
INSTANCE_URL_ARGS=()
EFFECTIVE_INSTANCE_URL="${MEMOS_INSTANCE_URL:-}"
if [ "$LOCAL_ONLY" = true ] && [ -z "$EFFECTIVE_INSTANCE_URL" ]; then
    EFFECTIVE_INSTANCE_URL="http://localhost:$HOST_PORT"
fi
if [ -n "$EFFECTIVE_INSTANCE_URL" ]; then
    INSTANCE_URL_ARGS=(-e "MEMOS_INSTANCE_URL=$EFFECTIVE_INSTANCE_URL")
fi

docker run -d \
    --name "$CONTAINER_NAME" \
    --user 10001:10001 \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    -p "$HOST_ADDR:$HOST_PORT:5230" \
    -v "$DATA_DIR:/var/opt/memos" \
    -e MEMOS_MODE=prod \
    -e MEMOS_PORT=5230 \
    "${INSTANCE_URL_ARGS[@]}" \
    --restart unless-stopped \
    "$RUN_IMAGE"

echo ""
echo "等待容器启动 ..."
sleep 3

if docker ps -f "name=^${CONTAINER_NAME}$" --format "{{.Status}}" | grep -q "Up"; then
    echo ""
    echo "=========================================="
    echo "部署成功！"
    echo "=========================================="
    docker ps -f "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""

    if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "readonly database"; then
        die "检测到数据库只读错误。请将数据目录授权给镜像内的非 root 用户（UID/GID 10001），例如: sudo chown -R 10001:10001 \"$DATA_DIR\""
    fi

    echo "访问地址:  http://localhost:$HOST_PORT"
    echo "数据目录:  $DATA_DIR"
    echo ""
    echo "常用命令:"
    echo "  docker logs -f $CONTAINER_NAME     # 查看日志"
    echo "  docker restart $CONTAINER_NAME      # 重启"
    echo "  docker stop $CONTAINER_NAME         # 停止"
    echo "=========================================="
else
    echo ""
    echo "错误: 容器启动失败" >&2
    echo "查看日志: docker logs $CONTAINER_NAME" >&2
    docker logs "$CONTAINER_NAME" --tail 20 2>&1 >&2 || true
    exit 1
fi
