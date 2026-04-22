package httpgetter

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

var ErrInternalIP = errors.New("internal IP addresses are not allowed")

const (
	requestTimeout     = 5 * time.Second
	maxResponseBodyLen = 1 * 1024 * 1024
)

var defaultResolver = &net.Resolver{}

type validatedTarget struct {
	url  *url.URL
	host string
	port string
}

func isDisallowedIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func validateURL(urlStr string) error {
	_, err := validateURLWithTarget(context.Background(), urlStr)
	return err
}

func validateURLWithTarget(ctx context.Context, urlStr string) (*validatedTarget, error) {
	u, err := url.Parse(urlStr)
	if err != nil {
		return nil, errors.New("invalid URL format")
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, errors.New("only http/https protocols are allowed")
	}

	host := u.Hostname()
	if host == "" {
		return nil, errors.New("empty hostname")
	}

	port := u.Port()
	if port == "" {
		if u.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	if ip := net.ParseIP(host); ip != nil {
		if isDisallowedIP(ip) {
			return nil, errors.Wrap(ErrInternalIP, ip.String())
		}
		return &validatedTarget{
			url:  u,
			host: host,
			port: port,
		}, nil
	}

	ips, err := defaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, errors.Errorf("failed to resolve hostname: %v", err)
	}
	if len(ips) == 0 {
		return nil, errors.New("hostname resolved to no IPs")
	}

	for _, ip := range ips {
		if isDisallowedIP(ip) {
			return nil, errors.Wrapf(ErrInternalIP, "host=%s, ip=%s", host, ip.String())
		}
	}

	return &validatedTarget{
		url:  u,
		host: host,
		port: port,
	}, nil
}

func newHTTPClient() *http.Client {
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}

			resolvedAddr := addr
			if ip := net.ParseIP(host); ip != nil {
				if isDisallowedIP(ip) {
					return nil, errors.Wrap(ErrInternalIP, ip.String())
				}
				resolvedAddr = net.JoinHostPort(ip.String(), port)
			} else {
				ips, err := defaultResolver.LookupIP(ctx, "ip", host)
				if err != nil {
					return nil, errors.Wrap(err, "failed to resolve hostname")
				}
				if len(ips) == 0 {
					return nil, errors.New("hostname resolved to no IPs")
				}
				for _, ip := range ips {
					if isDisallowedIP(ip) {
						return nil, errors.Wrapf(ErrInternalIP, "host=%s, ip=%s", host, ip.String())
					}
				}
				resolvedAddr = net.JoinHostPort(ips[0].String(), port)
			}

			var d net.Dialer
			return d.DialContext(ctx, network, resolvedAddr)
		},
	}

	return &http.Client{
		Timeout: requestTimeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("too many redirects")
			}
			_, err := validateURLWithTarget(req.Context(), req.URL.String())
			if err != nil {
				return errors.Wrap(err, "redirect to internal IP")
			}
			return nil
		},
	}
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

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, validated.url.String(), nil)
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
	enrichSiteMeta(validated.url, htmlMeta)
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
