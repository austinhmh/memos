package v1

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/grpc-ecosystem/grpc-gateway/v2/runtime"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const internalServerErrorMessage = "internal server error"

func internalError(message string, err error, attrs ...any) error {
	args := append([]any{}, attrs...)
	if err != nil {
		args = append(args, "error", err)
	}
	slog.Error(message, args...)
	return status.Error(codes.Internal, internalServerErrorMessage)
}

func sanitizedGatewayHTTPErrorHandler(ctx context.Context, mux *runtime.ServeMux, marshaler runtime.Marshaler, w http.ResponseWriter, r *http.Request, err error) {
	var customStatus *runtime.HTTPStatusError
	if errors.As(err, &customStatus) {
		if st, ok := status.FromError(customStatus.Err); ok && st.Code() == codes.Internal {
			slog.Error("internal gateway error", "error", customStatus.Err)
			err = &runtime.HTTPStatusError{
				HTTPStatus: customStatus.HTTPStatus,
				Err:        status.Error(codes.Internal, internalServerErrorMessage),
			}
		}
	} else if st, ok := status.FromError(err); ok && st.Code() == codes.Internal {
		slog.Error("internal gateway error", "error", err)
		err = status.Error(codes.Internal, internalServerErrorMessage)
	}
	runtime.DefaultHTTPErrorHandler(ctx, mux, marshaler, w, r, err)
}
