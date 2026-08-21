package tools

import (
	"encoding/json"
	"log/slog"
	"strings"
)

const minOutputChars = 128

// ErrorType mirrors ToolResponseEncoder.kt's private ErrorType enum.
type ErrorType string

const (
	ErrSQLSyntax     ErrorType = "SQL_SYNTAX"
	ErrSQLPermission ErrorType = "SQL_PERMISSION"
	ErrSQLNotFound   ErrorType = "SQL_NOT_FOUND"
	ErrTimeout       ErrorType = "TIMEOUT"
	ErrConnection    ErrorType = "CONNECTION"
	ErrInvalidInput  ErrorType = "INVALID_INPUT"
	ErrUnknown       ErrorType = "UNKNOWN"
)

// ResponseEncoder ports ToolResponseEncoder.kt 1:1: JSON encode + char budget + error generalization.
type ResponseEncoder struct {
	maxOutputChars int
	logger         *slog.Logger
}

// NewResponseEncoder mirrors the Kotlin constructor's minOutputChars guard.
func NewResponseEncoder(maxOutputChars int, logger *slog.Logger) *ResponseEncoder {
	if maxOutputChars < minOutputChars {
		panic("maxOutputChars는 구조화된 오류를 담을 수 있도록 128 이상이어야 합니다.")
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &ResponseEncoder{maxOutputChars: maxOutputChars, logger: logger}
}

// Encode mirrors encode(value, outputLimit = maxOutputChars).
func (e *ResponseEncoder) Encode(value any, outputLimit int) (string, error) {
	if outputLimit == 0 {
		outputLimit = e.maxOutputChars
	}
	if outputLimit < minOutputChars {
		panic("outputLimit은 구조화된 오류를 담을 수 있도록 128 이상이어야 합니다.")
	}
	b, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	js := string(b)
	if len([]rune(js)) <= outputLimit {
		return js, nil
	}
	truncated, err := json.Marshal(map[string]any{
		"error":          "tool_output_too_large",
		"truncated":      true,
		"originalChars":  len([]rune(js)),
		"maxOutputChars": outputLimit,
	})
	if err != nil {
		return "", err
	}
	return string(truncated), nil
}

// EncodeError mirrors encodeError(error): classify -> generalized user message -> raw detail only logged.
func (e *ResponseEncoder) EncodeError(err error) string {
	errType := classifyError(err)
	userMessage := userFriendlyMessage(errType)

	e.logger.Warn("도구 실행 오류", "type", errType, "message", err.Error())

	encoded, marshalErr := json.Marshal(map[string]any{
		"error":     userMessage,
		"type":      string(errType),
		"truncated": false,
	})
	if marshalErr != nil {
		return `{"error":"내부 오류가 발생했습니다.","type":"UNKNOWN","truncated":false}`
	}
	if len([]rune(string(encoded))) <= e.maxOutputChars {
		return string(encoded)
	}

	fallback, _ := json.Marshal(map[string]any{
		"error":     "내부 오류가 발생했습니다.",
		"type":      "UNKNOWN",
		"truncated": true,
	})
	return string(fallback)
}

// classifyError mirrors classifyError(e: Exception): substring match on lowercased message.
// Go errors have no cause chain to unwrap distinctly from message the way Kotlin's
// `e.cause?.message ?: e.message` does, so we match against err.Error() directly;
// callers that need cause-message priority should wrap with that message first.
func classifyError(err error) ErrorType {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "syntax error"):
		return ErrSQLSyntax
	case strings.Contains(message, "permission denied"):
		return ErrSQLPermission
	case strings.Contains(message, "does not exist"):
		return ErrSQLNotFound
	case strings.Contains(message, "timeout"), strings.Contains(message, "timed out"):
		return ErrTimeout
	case strings.Contains(message, "connection"):
		return ErrConnection
	default:
		if _, ok := err.(*SqlGuardError); ok {
			return ErrInvalidInput
		}
		return ErrUnknown
	}
}

func userFriendlyMessage(t ErrorType) string {
	switch t {
	case ErrSQLSyntax:
		return "SQL 문법 오류입니다. 질의를 다시 확인해주세요."
	case ErrSQLPermission:
		return "데이터베이스 접근 권한이 없습니다."
	case ErrSQLNotFound:
		return "요청한 데이터를 찾을 수 없습니다."
	case ErrTimeout:
		return "질의 실행 시간이 초과되었습니다. 조건을 좀 더 구체적으로 명시해주세요."
	case ErrConnection:
		return "데이터베이스 연결에 실패했습니다."
	case ErrInvalidInput:
		return "입력값이 올바르지 않습니다."
	default:
		return "내부 오류가 발생했습니다."
	}
}
