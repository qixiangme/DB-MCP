package tools

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Test names mirror ToolResponseEncoderTest.kt cases 1:1.

func TestEncoder_WithinBudgetKeepsJsonStructure(t *testing.T) {
	enc := NewResponseEncoder(200, nil)
	encoded, err := enc.Encode([]map[string]any{{"source": "guide", "text": "content"}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	var parsed []map[string]any
	if err := json.Unmarshal([]byte(encoded), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed[0]["source"] != "guide" {
		t.Fatalf("got %v", parsed[0]["source"])
	}
}

func TestEncoder_OverBudgetReturnsValidLimitJson(t *testing.T) {
	enc := NewResponseEncoder(200, nil)
	encoded, err := enc.Encode(map[string]any{"rows": []string{strings.Repeat("x", 500)}}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > 200 {
		t.Fatalf("encoded length %d exceeds 200", len(encoded))
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(encoded), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["error"] != "tool_output_too_large" {
		t.Fatalf("got %v", parsed["error"])
	}
	if parsed["truncated"] != true {
		t.Fatalf("got %v", parsed["truncated"])
	}
	if int(parsed["maxOutputChars"].(float64)) != 200 {
		t.Fatalf("got %v", parsed["maxOutputChars"])
	}
	if int(parsed["originalChars"].(float64)) <= 200 {
		t.Fatalf("expected originalChars > 200, got %v", parsed["originalChars"])
	}
}

func TestEncoder_PerCallOutputLimitOverridesDefault(t *testing.T) {
	enc := NewResponseEncoder(200, nil)
	encoded, err := enc.Encode(map[string]any{"schema": strings.Repeat("x", 300)}, 500)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(encoded), &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed["schema"].(string)) != 300 {
		t.Fatalf("got len %d", len(parsed["schema"].(string)))
	}
}

func TestEncoder_ErrorResponseGeneralizesAndHidesInternals(t *testing.T) {
	enc := NewResponseEncoder(500, nil)
	encoded := enc.EncodeError(errors.New("column employees.secret_salary does not exist"))
	var parsed map[string]any
	if err := json.Unmarshal([]byte(encoded), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["error"] != "요청한 데이터를 찾을 수 없습니다." {
		t.Fatalf("got %v", parsed["error"])
	}
	if parsed["type"] != "SQL_NOT_FOUND" {
		t.Fatalf("got %v", parsed["type"])
	}
}

func TestEncoder_SqlSyntaxErrorGeneralized(t *testing.T) {
	enc := NewResponseEncoder(500, nil)
	encoded := enc.EncodeError(errors.New(`syntax error at or near "SELEC" at position 1`))
	var parsed map[string]any
	json.Unmarshal([]byte(encoded), &parsed)
	if parsed["error"] != "SQL 문법 오류입니다. 질의를 다시 확인해주세요." {
		t.Fatalf("got %v", parsed["error"])
	}
	if parsed["type"] != "SQL_SYNTAX" {
		t.Fatalf("got %v", parsed["type"])
	}
}

func TestEncoder_PermissionErrorGeneralized(t *testing.T) {
	enc := NewResponseEncoder(500, nil)
	encoded := enc.EncodeError(errors.New("permission denied for table employees"))
	var parsed map[string]any
	json.Unmarshal([]byte(encoded), &parsed)
	if parsed["error"] != "데이터베이스 접근 권한이 없습니다." {
		t.Fatalf("got %v", parsed["error"])
	}
	if parsed["type"] != "SQL_PERMISSION" {
		t.Fatalf("got %v", parsed["type"])
	}
}

func TestEncoder_UnknownErrorReturnsUnknownType(t *testing.T) {
	enc := NewResponseEncoder(500, nil)
	encoded := enc.EncodeError(errors.New("unexpected error"))
	var parsed map[string]any
	json.Unmarshal([]byte(encoded), &parsed)
	if parsed["error"] != "내부 오류가 발생했습니다." {
		t.Fatalf("got %v", parsed["error"])
	}
	if parsed["type"] != "UNKNOWN" {
		t.Fatalf("got %v", parsed["type"])
	}
}
