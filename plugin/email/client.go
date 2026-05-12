package email

import (
	"crypto/tls"
	"log/slog"
	"net/smtp"

	"github.com/pkg/errors"
)

// Client represents an SMTP email client.
type Client struct {
	config *Config
}

// NewClient creates a new email client with the given configuration.
func NewClient(config *Config) *Client {
	return &Client{
		config: config,
	}
}

// validateConfig validates the client configuration.
func (c *Client) validateConfig() error {
	if c.config == nil {
		return errors.New("email configuration is required")
	}
	return c.config.Validate()
}

// createAuth creates an SMTP auth mechanism if credentials are provided.
func (c *Client) createAuth() smtp.Auth {
	if c.config.SMTPUsername == "" && c.config.SMTPPassword == "" {
		return nil
	}
	return smtp.PlainAuth("", c.config.SMTPUsername, c.config.SMTPPassword, c.config.SMTPHost)
}

// createTLSConfig creates a TLS configuration for secure connections.
func (c *Client) createTLSConfig() *tls.Config {
	return &tls.Config{
		ServerName: c.config.SMTPHost,
		MinVersion: tls.VersionTLS12,
	}
}

// Send sends an email message via SMTP.
func (c *Client) Send(message *Message) error {
	if err := c.validateConfig(); err != nil {
		return errors.Wrap(err, "invalid email configuration")
	}
	if message == nil {
		return errors.New("message is required")
	}
	if err := message.Validate(); err != nil {
		return errors.Wrap(err, "invalid email message")
	}
	body := message.Format(c.config.FromEmail, c.config.FromName)
	recipients := message.GetAllRecipients()
	auth := c.createAuth()

	// Send based on encryption type
	if c.config.UseSSL {
		return c.sendWithSSL(auth, recipients, body)
	}
	return c.sendWithTLS(auth, recipients, body)
}

// sendWithTLS sends email using STARTTLS (port 587).
func (c *Client) sendWithTLS(auth smtp.Auth, recipients []string, body string) error {
	serverAddr := c.config.GetServerAddress()

	if c.config.UseTLS {
		return smtp.SendMail(serverAddr, auth, c.config.FromEmail, recipients, []byte(body))
	}

	slog.Warn("sending email without encryption is insecure, consider enabling TLS or SSL",
		slog.String("smtp_host", c.config.SMTPHost))
	return smtp.SendMail(serverAddr, auth, c.config.FromEmail, recipients, []byte(body))
}

// sendWithSSL sends email using SSL/TLS (port 465).
func (c *Client) sendWithSSL(auth smtp.Auth, recipients []string, body string) error {
	serverAddr := c.config.GetServerAddress()

	// Create TLS connection
	tlsConfig := c.createTLSConfig()
	conn, err := tls.Dial("tcp", serverAddr, tlsConfig)
	if err != nil {
		return errors.Wrapf(err, "failed to connect to SMTP server with SSL: %s", serverAddr)
	}
	defer conn.Close()

	// Create SMTP client
	client, err := smtp.NewClient(conn, c.config.SMTPHost)
	if err != nil {
		return errors.Wrap(err, "failed to create SMTP client")
	}
	defer client.Quit()

	// Authenticate
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return errors.Wrap(err, "SMTP authentication failed")
		}
	}

	// Set sender
	if err := client.Mail(c.config.FromEmail); err != nil {
		return errors.Wrap(err, "failed to set sender")
	}

	// Set recipients
	for _, recipient := range recipients {
		if err := client.Rcpt(recipient); err != nil {
			return errors.Wrapf(err, "failed to set recipient: %s", recipient)
		}
	}

	// Send message body
	writer, err := client.Data()
	if err != nil {
		return errors.Wrap(err, "failed to send DATA command")
	}

	if _, err := writer.Write([]byte(body)); err != nil {
		return errors.Wrap(err, "failed to write message body")
	}

	if err := writer.Close(); err != nil {
		return errors.Wrap(err, "failed to close message writer")
	}

	return nil
}
