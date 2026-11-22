#!/usr/bin/env bash
# Run as the owner of the existing acme.sh installation on 144.
set -euo pipefail
domain=docs.ailink1.com
webroot=/opt/llm/data/nginx/html
certdir=/opt/llm/data/nginx/certs/$domain
acme=/home/ubuntu/.acme.sh/acme.sh
[[ ! -f "$certdir/.acme-installed" ]] || exit 0

# Check the public HTTP route before placing a certificate order.
probe=$(mktemp "$webroot/.well-known/acme-challenge/docs-probe.XXXXXXXXXXXX")
trap 'rm -f "$probe"' EXIT
name=${probe##*/}
printf '%s' "$name" > "$probe"
chmod 644 "$probe"
response=$(curl -fsS --connect-timeout 5 --max-time 15 "http://$domain/.well-known/acme-challenge/$name" 2>/dev/null) || exit 0
[[ "$response" == "$name" ]] || exit 0

# Retry a failed order at most once per hour. A later installation failure
# can reuse the certificate already issued by acme.sh.
if [[ -n $(find "$certdir" -name .last-attempt -mmin -60 -print -quit) ]]; then exit 0; fi
touch "$certdir/.last-attempt"
issued=/home/ubuntu/.acme.sh/${domain}_ecc/fullchain.cer
if ! openssl x509 -checkend 86400 -noout -in "$issued" >/dev/null 2>&1; then
    "$acme" --issue --server letsencrypt --webroot "$webroot" --keylength ec-256 -d "$domain"
fi
"$acme" --install-cert --ecc -d "$domain" \
    --key-file "$certdir/privkey.pem" --fullchain-file "$certdir/fullchain.pem" \
    --reloadcmd 'docker exec nginx nginx -t && docker exec nginx nginx -s reload'
touch "$certdir/.acme-installed"
