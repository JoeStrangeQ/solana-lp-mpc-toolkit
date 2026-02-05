#!/bin/bash
# Stress test the LP Agent Toolkit API
# Uses `hey` - install with: brew install hey

API_URL="${API_URL:-https://lp-agent-api-production.up.railway.app}"

echo "🔥 LP Agent Toolkit Stress Test"
echo "================================"
echo "Target: $API_URL"
echo ""

# Test 1: Health endpoint (lightweight)
echo "📊 Test 1: Health endpoint (100 req, 10 concurrent)"
hey -n 100 -c 10 "$API_URL/health" 2>/dev/null | grep -E "Requests/sec|Average|Fastest|Slowest|Status code"
echo ""

# Test 2: Fees endpoint (lightweight read)
echo "📊 Test 2: Fees endpoint (100 req, 10 concurrent)"
hey -n 100 -c 10 "$API_URL/fees" 2>/dev/null | grep -E "Requests/sec|Average|Fastest|Slowest|Status code"
echo ""

# Test 3: Encrypt endpoint (crypto operations)
echo "📊 Test 3: Encrypt endpoint (50 req, 5 concurrent)"
hey -n 50 -c 5 -m POST \
  -H "Content-Type: application/json" \
  -d '{"strategy":{"type":"concentrated","binRange":[-10,10],"distribution":"gaussian"}}' \
  "$API_URL/encrypt" 2>/dev/null | grep -E "Requests/sec|Average|Fastest|Slowest|Status code"
echo ""

# Test 4: Wallet create (heavy - Privy API calls)
echo "📊 Test 4: Wallet create (10 req, 2 concurrent) - CAREFUL: creates real wallets"
read -p "Run wallet creation test? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  hey -n 10 -c 2 -m POST \
    -H "Content-Type: application/json" \
    "$API_URL/wallet/create" 2>/dev/null | grep -E "Requests/sec|Average|Fastest|Slowest|Status code"
else
  echo "Skipped"
fi
echo ""

# Show stats
echo "📈 Current Stats:"
curl -s "$API_URL/stats" | jq '.requests.total, .actions, .errors' 2>/dev/null || curl -s "$API_URL/stats"
