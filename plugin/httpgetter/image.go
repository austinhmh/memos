package httpgetter

import (
	"errors"
	"io"
	"strings"
)

const maxImageSize = 50 * 1024 * 1024 // 50 MiB

type Image struct {
	Blob      []byte
	Mediatype string
}

func GetImage(urlStr string) (*Image, error) {
	if err := validateURL(urlStr); err != nil {
		return nil, err
	}

	response, err := httpClient.Get(urlStr)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	mediatype, err := getMediatype(response)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(mediatype, "image/") {
		return nil, errors.New("wrong image mediatype")
	}

	limitedReader := io.LimitReader(response.Body, maxImageSize+1)
	bodyBytes, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, err
	}
	if len(bodyBytes) > maxImageSize {
		return nil, errors.New("image exceeds maximum allowed size")
	}

	image := &Image{
		Blob:      bodyBytes,
		Mediatype: mediatype,
	}
	return image, nil
}
