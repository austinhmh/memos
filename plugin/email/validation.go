package email

import (
	"mime"
	"net/mail"
	"strings"
	"unicode/utf8"

	"github.com/pkg/errors"
)

func validateNoCRLF(field, value string) error {
	if strings.ContainsAny(value, "\r\n") {
		return errors.Errorf("%s must not contain CRLF characters", field)
	}
	return nil
}

func validateHeaderValue(field, value string) error {
	if err := validateNoCRLF(field, value); err != nil {
		return err
	}
	if !utf8.ValidString(value) {
		return errors.Errorf("%s must be valid UTF-8", field)
	}
	return nil
}

func parseSingleAddress(field, value string) (*mail.Address, error) {
	if err := validateHeaderValue(field, value); err != nil {
		return nil, err
	}
	address, err := mail.ParseAddress(value)
	if err != nil {
		return nil, errors.Wrapf(err, "%s must be a valid email address", field)
	}
	if address.Name != "" || address.Address != strings.TrimSpace(value) {
		return nil, errors.Errorf("%s must be a plain email address", field)
	}
	return address, nil
}

func parseAddressList(field string, values []string) ([]*mail.Address, error) {
	addresses := make([]*mail.Address, 0, len(values))
	for _, value := range values {
		address, err := parseSingleAddress(field, value)
		if err != nil {
			return nil, err
		}
		addresses = append(addresses, address)
	}
	return addresses, nil
}

func formatAddress(address string, displayName string) string {
	if displayName == "" {
		return address
	}
	return (&mail.Address{Name: displayName, Address: address}).String()
}

func formatAddressList(addresses []string) string {
	return strings.Join(addresses, ", ")
}

func encodeSubject(subject string) string {
	return mime.QEncoding.Encode("utf-8", subject)
}
