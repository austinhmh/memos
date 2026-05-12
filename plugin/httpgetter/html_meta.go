package httpgetter

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"github.com/usememos/memos/internal/netutil"
)

var ErrInternalIP = netutil.ErrNonPublicAddress

const (
	requestTimeout     = 5 * time.Second
	maxResponseBodyLen = 1 * 1024 * 1024
)

func validateURL(urlStr string) error {
	_, err := validateURLWithTarget(context.Background(), urlStr)
	return err
}

func validateURLWithTarget(ctx context.Context, urlStr string) (*netutil.ValidatedExternalURL, error) {
	return netutil.ValidateExternalURL(ctx, urlStr)
}

func newHTTPClient() *http.Client {
	return netutil.NewExternalHTTPClient(requestTimeout)
}

type HTMLMeta struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Image       string `json:"image"`
	Favicon     string `json:"favicon"`
}

func GetHTMLMeta(urlStr string) (*HTMLMeta, error) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()

	validated, err := validateURLWithTarget(ctx, urlStr)
	if err != nil {
		return nil, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, validated.URL.String(), nil)
	if err != nil {
		return nil, err
	}

	response, err := newHTTPClient().Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	mediatype, err := getMediatype(response)
	if err != nil {
		return nil, err
	}
	if mediatype != "text/html" {
		return nil, errors.New("not a HTML page")
	}

	limitedBody := io.LimitReader(response.Body, maxResponseBodyLen)

	htmlMeta := extractHTMLMeta(limitedBody)
	enrichSiteMeta(validated.URL, htmlMeta)
	return htmlMeta, nil
}

func extractHTMLMeta(resp io.Reader) *HTMLMeta {
	tokenizer := html.NewTokenizer(resp)
	htmlMeta := new(HTMLMeta)

	for {
		tokenType := tokenizer.Next()
		if tokenType == html.ErrorToken {
			break
		} else if tokenType == html.StartTagToken || tokenType == html.SelfClosingTagToken {
			token := tokenizer.Token()
			if token.DataAtom == atom.Body {
				break
			}

			if token.DataAtom == atom.Title {
				tokenizer.Next()
				token := tokenizer.Token()
				htmlMeta.Title = token.Data
			} else if token.DataAtom == atom.Link {
				if htmlMeta.Favicon == "" {
					favicon, ok := extractFaviconLink(token)
					if ok {
						htmlMeta.Favicon = favicon
					}
				}
			} else if token.DataAtom == atom.Meta {
				description, ok := extractMetaProperty(token, "description")
				if ok {
					htmlMeta.Description = description
				}

				ogTitle, ok := extractMetaProperty(token, "og:title")
				if ok {
					htmlMeta.Title = ogTitle
				}

				ogDescription, ok := extractMetaProperty(token, "og:description")
				if ok {
					htmlMeta.Description = ogDescription
				}

				ogImage, ok := extractMetaProperty(token, "og:image")
				if ok {
					htmlMeta.Image = ogImage
				}
			}
		}
	}

	return htmlMeta
}

func extractMetaProperty(token html.Token, prop string) (content string, ok bool) {
	content, ok = "", false
	for _, attr := range token.Attr {
		if attr.Key == "property" && attr.Val == prop {
			ok = true
		}
		if attr.Key == "content" {
			content = attr.Val
		}
	}
	return content, ok
}

func enrichSiteMeta(url *url.URL, meta *HTMLMeta) {
	if url.Hostname() == "www.youtube.com" {
		if url.Path == "/watch" {
			vid := url.Query().Get("v")
			if vid != "" {
				meta.Image = fmt.Sprintf("https://img.youtube.com/vi/%s/mqdefault.jpg", vid)
			}
		}
	}
	if meta.Favicon == "" {
		meta.Favicon = fmt.Sprintf("%s://%s/favicon.ico", url.Scheme, url.Host)
	} else if !isAbsoluteURL(meta.Favicon) {
		meta.Favicon = fmt.Sprintf("%s://%s%s", url.Scheme, url.Host, meta.Favicon)
	}
	if meta.Image != "" && !isAbsoluteURL(meta.Image) {
		meta.Image = fmt.Sprintf("%s://%s%s", url.Scheme, url.Host, meta.Image)
	}
}

func isAbsoluteURL(u string) bool {
	return len(u) > 4 && (u[:4] == "http" || u[:2] == "//")
}

func extractFaviconLink(token html.Token) (string, bool) {
	var href string
	isIcon := false
	for _, attr := range token.Attr {
		if attr.Key == "rel" {
			val := strings.ToLower(attr.Val)
			if strings.Contains(val, "icon") {
				isIcon = true
			}
		}
		if attr.Key == "href" {
			href = attr.Val
		}
	}
	if isIcon && href != "" {
		return href, true
	}
	return "", false
}
