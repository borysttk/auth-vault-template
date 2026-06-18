#!/bin/bash
# End-to-end test for MCP Auth Vault
# Tests: store → retrieve (with and without password) → delete

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export VAULT_ENCRYPTION_KEY="caf62e1235be4e011190b53c5526baa96a10c1b74ed9c84e004e39ee0d2147cb"
export VAULT_ROOT="./vault-test"
export LOG_LEVEL=error

# Clean test vault
rm -rf "$VAULT_ROOT"

# Test 1: list_services
echo "=== Test 1: list_services ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_services","arguments":{}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['result']['content'][0]['text']; print('  OK -', json.loads(d['result']['content'][0]['text'])['count'], 'services')"

# Test 2: store_credentials
echo "=== Test 2: store_credentials ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"store_credentials","arguments":{"service":"google","label":"Test Account","username":"user@test.com","password":"secret123","tags":["test"]}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
CRED_ID=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text'])['id'])")
echo "  OK - Credential ID: $CRED_ID"

# Test 3: list_credentials
echo "=== Test 3: list_credentials ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_credentials","arguments":{}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); txt=json.loads(d['result']['content'][0]['text']); assert txt['count']==1; print('  OK -', txt['count'], 'credential(s)')"

# Test 4: get_credentials (without password)
echo "=== Test 4: get_credentials (masked) ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_credentials","arguments":{"id":"%s"}}}\n' "$CRED_ID" | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "
import json,sys; d=json.load(sys.stdin)
txt=json.loads(d['result']['content'][0]['text'])
assert txt['credentials']['password'] == '***', 'Password should be masked'
print('  OK - Password masked')
print('  Username:', txt['credentials']['username'])
"

# Test 5: get_credentials (with password)
echo "=== Test 5: get_credentials (unmasked) ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_credentials","arguments":{"id":"%s","includePassword":true}}}\n' "$CRED_ID" | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "
import json,sys; d=json.load(sys.stdin)
txt=json.loads(d['result']['content'][0]['text'])
assert txt['credentials']['password'] == 'secret123', 'Password should be returned'
print('  OK - Password returned:', txt['credentials']['password'])
"

# Test 6: delete_credentials
echo "=== Test 6: delete_credentials ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"delete_credentials","arguments":{"id":"%s"}}}\n' "$CRED_ID" | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "
import json,sys; d=json.load(sys.stdin)
txt=json.loads(d['result']['content'][0]['text'])
assert txt['success'] == True, 'Should delete successfully'
print('  OK - Deleted')
"

# Test 7: verify empty after delete
echo "=== Test 7: verify empty ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"list_credentials","arguments":{}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); txt=json.loads(d['result']['content'][0]['text']); assert txt['count']==0; print('  OK -', txt['count'], 'credentials remaining')"

# Test 8: store 2 credentials for service filtering
echo "=== Test 8: store second credential ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"store_credentials","arguments":{"service":"arena.ai","label":"Arena Work","username":"work@arena.com","password":"arena-pass"}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
CRED2_ID=$(echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.loads(d['result']['content'][0]['text'])['id'])")
echo "  OK - Arena credential ID: $CRED2_ID"

# Test 9: list_credentials filtered by service
echo "=== Test 9: list_credentials (filtered) ==="
RESULT=$(printf '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_credentials","arguments":{"service":"arena.ai"}}}\n' | timeout 5 node dist/index.js 2>/dev/null)
echo "$RESULT" | python3 -c "
import json,sys; d=json.load(sys.stdin)
txt=json.loads(d['result']['content'][0]['text'])
assert txt['count']==1, f'Expected 1 arena.ai credential, got {txt[\"count\"]}'
print('  OK -', txt['count'], 'credential(s) for arena.ai')
"

echo ""
echo "=== ALL TESTS PASSED ==="

# Cleanup
rm -rf "$VAULT_ROOT"
