#!/bin/bash
#
# Run server tests file-by-file for complete isolation
# This prevents mock leakage between test files
#

set -e  # Exit on first failure

# Change to server directory
cd "$(dirname "$0")/../packages/server"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Running tests file-by-file for complete isolation"
echo ""

# Track results
TOTAL=0
PASSED=0
FAILED=0
FAILED_FILES=()

# Find all test files
TEST_FILES=$(find src -name "*.test.ts" -type f | sort)
FILE_COUNT=$(echo "$TEST_FILES" | wc -l | tr -d ' ')

for file in $TEST_FILES; do
    TOTAL=$((TOTAL + 1))
    
    # Run test
    echo -n "Testing $file ... "
    
    if bun test "$file" > /tmp/test-output.txt 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAIL${NC}"
        FAILED=$((FAILED + 1))
        FAILED_FILES+=("$file")
        
        # Show error details
        echo -e "${YELLOW}Error details:${NC}"
        tail -20 /tmp/test-output.txt | grep -E "(fail|error|Error)" || echo "  (see full output in /tmp/test-output.txt)"
        echo ""
    fi
    
    # Show running success rate
    SUCCESS_PERCENT=$((PASSED * 100 / TOTAL))
    echo -e "   ${GREEN}→ Success: $PASSED/$TOTAL ($SUCCESS_PERCENT%)${NC}"
done

echo ""
echo "======================================"
echo "Test Summary"
echo "======================================"
echo "Total:  $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed files:${NC}"
    for file in "${FAILED_FILES[@]}"; do
        echo "  - $file"
    done
    exit 1
else
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
fi
