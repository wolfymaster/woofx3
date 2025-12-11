package services

// import (
// 	"crypto/hmac"
// 	"crypto/sha256"
// 	"encoding/base64"
// 	"errors"
// 	"fmt"
// 	"os"
// 	"strconv"
// 	"strings"
// 	"time"

// 	"github.com/golang-jwt/jwt/v5"
// 	"github.com/google/uuid"
// 	"golang.org/x/crypto/bcrypt"
// 	"gorm.io/gorm"
	
// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type authService struct {
// 	baseService[models.User]
// 	jwtSecret        []byte
// 	jwtExpiration    time.Duration
// 	clientJWTSecret  []byte
// 	clientExpiration time.Duration
// 	userService      UserService
// }

// // NewAuthService creates a new instance of AuthService
// func NewAuthService(userService UserService) AuthService {
// 	service := &authService{
// 		baseService: baseService[models.User]{},
// 		userService: userService,
// 	}

// 	// Initialize JWT secrets and expirations
// 	service.initializeSecrets()

// 	return service
// }

// // initializeSecrets loads JWT configuration from environment variables
// func (s *authService) initializeSecrets() {
// 	// Get JWT secret from environment variable or use a default
// 	jwtSecret := os.Getenv("JWT_SECRET")
// 	if jwtSecret == "" {
// 		jwtSecret = "default-jwt-secret-please-change-in-production"
// 	}

// 	// Get client JWT secret from environment variable or use a different default
// 	clientJWTSecret := os.Getenv("CLIENT_JWT_SECRET")
// 	if clientJWTSecret == "" {
// 		clientJWTSecret = "default-client-jwt-secret-please-change-in-production"
// 	}

// 	// Default to 24 hours expiration for user tokens
// 	userExpiration := 24 * time.Hour
// 	if expStr := os.Getenv("JWT_EXPIRATION"); expStr != "" {
// 		if exp, err := time.ParseDuration(expStr); err == nil {
// 			userExpiration = exp
// 		}
// 	}

// 	// Default to 30 days for client tokens
// 	clientExpiration := 720 * time.Hour // 30 days
// 	if expStr := os.Getenv("CLIENT_JWT_EXPIRATION"); expStr != "" {
// 		if exp, err := time.ParseDuration(expStr); err == nil {
// 			clientExpiration = exp
// 		}
// 	}

// 	s.jwtSecret = []byte(jwtSecret)
// 	s.jwtExpiration = userExpiration
// 	s.clientJWTSecret = []byte(clientJWTSecret)
// 	s.clientExpiration = clientExpiration
// }

// // Login authenticates a user and returns a JWT token
// // func (s *authService) Login(db *gorm.DB, username, password string) (string, *models.User, error) {
// // 	// Get user by username
// // 	user, err := s.userService.GetByUsername(db, username)
// // 	if err != nil {
// // 		return "", nil, fmt.Errorf("invalid credentials")
// // 	}

// // 	// Verify password
// // 	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
// // 		return "", nil, fmt.Errorf("invalid credentials")
// // 	}

// // 	// Generate JWT token
// // 	token, err := s.generateToken(user)
// // 	if err != nil {
// // 		return "", nil, fmt.Errorf("failed to generate token: %w", err)
// // 	}

// // 	// Generate refresh token
// // 	refreshToken, err := s.generateRefreshToken(user.ID)
// // 	if err != nil {
// // 		return "", nil, fmt.Errorf("failed to generate refresh token: %w", err)
// // 	}

// // 	// Save the refresh token (in a real app, you might want to store this in a database)
// // 	// For now, we'll just return it

// // 	return token, user, nil
// // }

// // ValidateToken validates a JWT token and returns the token object
// func (s *authService) ValidateToken(tokenString string) (*jwt.Token, error) {
// 	// Parse the token
// 	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
// 		// Validate the signing method
// 		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
// 			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
// 		}
// 		return s.jwtSecret, nil
// 	})

// 	if err != nil {
// 		return nil, fmt.Errorf("invalid token: %w", err)
// 	}

// 	// Check if the token is valid
// 	if !token.Valid {
// 		return nil, errors.New("invalid token")
// 	}

// 	return token, nil
// }

// // RefreshToken generates a new access token using a refresh token
// func (s *authService) RefreshToken(db *gorm.DB, refreshToken string) (string, *models.User, error) {
// 	// In a real app, you would validate the refresh token against a database
// 	// For this example, we'll just validate it's a valid JWT
// 	token, err := jwt.Parse(refreshToken, func(token *jwt.Token) (interface{}, error) {
// 		// Validate the signing method
// 		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
// 			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
// 		}
// 		return s.jwtSecret, nil
// 	})

// 	if err != nil {
// 		return "", nil, fmt.Errorf("invalid refresh token: %w", err)
// 	}

// 	// Check if the token is valid
// 	if !token.Valid {
// 		return "", nil, errors.New("invalid refresh token")
// 	}

// 	// Get the user ID from the token claims
// 	claims, ok := token.Claims.(jwt.MapClaims)
// 	if !ok {
// 		return "", nil, errors.New("invalid token claims")
// 	}

// 	// Get the user ID from the claims
// 	userIDStr, ok := claims["sub"].(string)
// 	if !ok {
// 		return "", nil, errors.New("invalid user ID in token")
// 	}

// 	userID, err := uuid.Parse(userIDStr)
// 	if err != nil {
// 		return "", nil, fmt.Errorf("invalid user ID format: %w", err)
// 	}

// 	// Get the user from the database
// 	user, err := s.userService.GetByID(db, userID)
// 	if err != nil {
// 		return "", nil, fmt.Errorf("user not found: %w", err)
// 	}

// 	// Generate a new access token
// 	newToken, err := s.generateToken(user)
// 	if err != nil {
// 		return "", nil, fmt.Errorf("failed to generate new token: %w", err)
// 	}

// 	return newToken, user, nil
// }

// // Logout invalidates a user's refresh token
// func (s *authService) Logout(db *gorm.DB, userID uuid.UUID) error {
// 	// In a real app, you would invalidate the refresh token in the database
// 	// For this example, we'll just return success
// 	return nil
// }

// // GetUserFromToken extracts the user from a JWT token
// func (s *authService) GetUserFromToken(token *jwt.Token) (*models.User, error) {
// 	claims, ok := token.Claims.(jwt.MapClaims)
// 	if !ok || !token.Valid {
// 		return nil, errors.New("invalid token claims")
// 	}

// 	// Get user ID from claims
// 	userID, ok := claims["sub"].(float64) // JSON numbers are float64
// 	if !ok || userID == 0 {
// 		// Try to parse as string for backward compatibility
// 		userIDStr, ok := claims["sub"].(string)
// 		if !ok || userIDStr == "" {
// 			return nil, errors.New("missing or invalid user ID in token")
// 		}
		
// 		// Try to parse string as int
// 		var err error
// 		userIDInt, err := strconv.Atoi(userIDStr)
// 		if err != nil {
// 			return nil, fmt.Errorf("invalid user ID format: %w", err)
// 		}
// 		userID = float64(userIDInt)
// 	}

// 	// Create a minimal user object with just the ID
// 	// In a real app, you might want to fetch the full user from the database
// 	return &models.User{
// 		ID: int(userID),
// 	}, nil
// }

// // generateToken generates a new JWT token for a user
// func (s *authService) generateToken(user *models.User) (string, error) {
// 	// Set token claims
// 	claims := jwt.MapClaims{
// 		"sub":  user.ID, // Store as int
// 		"name": user.Username,
// 		"iat":  time.Now().Unix(),
// 		"exp":  time.Now().Add(s.jwtExpiration).Unix(),
// 	}

// 	// Create token
// 	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

// 	// Generate encoded token
// 	return token.SignedString(s.jwtSecret)
// }

// // generateRefreshToken generates a new refresh token for a user
// func (s *authService) generateRefreshToken(userID int) (string, error) {
// 	// Create a refresh token with a longer expiration
// 	claims := jwt.MapClaims{
// 		"sub": userID, // Store as int
// 		"iat": time.Now().Unix(),
// 		// Refresh tokens typically have a much longer expiration
// 		"exp": time.Now().Add(30 * 24 * time.Hour).Unix(),
// 	}

// 	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
// 	return token.SignedString(s.jwtSecret)
// }

// // hashRefreshToken creates a hash of the refresh token for secure storage
// func (s *authService) hashRefreshToken(token string) string {
// 	h := hmac.New(sha256.New, s.jwtSecret)
// 	h.Write([]byte(token))
// 	return base64.URLEncoding.EncodeToString(h.Sum(nil))
// }

// // validateRefreshToken validates a refresh token and returns the user ID
// func (s *authService) validateRefreshToken(tokenString string) (string, error) {
// 	// Parse the token
// 	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
// 		// Validate the alg is what we expect
// 		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
// 			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
// 		}

// 		// Return the secret key
// 		return s.jwtSecret, nil
// 	})

// 	if err != nil {
// 		return "", fmt.Errorf("invalid refresh token: %v", err)
// 	}

// 	// Validate the token
// 	if !token.Valid {
// 		return "", errors.New("invalid refresh token")
// 	}

// 	// Extract the claims
// 	claims, ok := token.Claims.(jwt.MapClaims)
// 	if !ok || !token.Valid {
// 		return "", errors.New("invalid token claims")
// 	}

// 	// Check the token type
// 	tokenType, ok := claims["type"].(string)
// 	if !ok || tokenType != "refresh" {
// 		return "", errors.New("invalid token type")
// 	}

// 	// Get the user ID
// 	userID, ok := claims["user_id"].(string)
// 	if !ok || userID == "" {
// 		return "", errors.New("invalid user ID in token")
// 	}

// 	return userID, nil
// }

// // AuthenticateClient authenticates a client using client ID and secret
// func (s *authService) AuthenticateClient(db *gorm.DB, clientID, clientSecret string) (*models.Client, error) {
// 	// Parse the client ID as UUID
// 	clientUUID, err := uuid.Parse(clientID)
// 	if err != nil {
// 		return nil, fmt.Errorf("invalid client ID format: %v", err)
// 	}

// 	// Find the client by ID
// 	var client models.Client
// 	if err := db.Where("client_id = ?", clientUUID).First(&client).Error; err != nil {
// 		if errors.Is(err, gorm.ErrRecordNotFound) {
// 			return nil, errors.New("client not found")
// 		}
// 		return nil, fmt.Errorf("database error: %v", err)
// 	}

// 	// Verify the client secret
// 	if client.ClientSecret != clientSecret {
// 		return nil, errors.New("invalid client credentials")
// 	}

// 	return &client, nil
// }

// // GenerateClientToken generates a new JWT token for a client
// func (s *authService) GenerateClientToken(client *models.Client) (string, error) {
// 	// Set token claims
// 	claims := jwt.MapClaims{
// 		"client_id": client.ClientID.String(),
// 		"app_id":    client.ApplicationID.String(),
// 		"type":      "client",
// 		"exp":       time.Now().Add(s.clientExpiration).Unix(),
// 		"iat":       time.Now().Unix(),
// 	}

// 	// Create token with claims
// 	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

// 	// Generate encoded token
// 	tokenString, err := token.SignedString(s.clientJWTSecret)
// 	if err != nil {
// 		return "", fmt.Errorf("failed to generate token: %v", err)
// 	}

// 	return tokenString, nil
// }

// // ValidateClientToken validates a client JWT token and returns the token object
// func (s *authService) ValidateClientToken(tokenString string) (*jwt.Token, error) {
// 	// Parse the token
// 	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
// 		// Validate the alg is what we expect
// 		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
// 			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
// 		}

// 		// Return the client secret key
// 		return s.clientJWTSecret, nil
// 	})

// 	if err != nil {
// 		return nil, fmt.Errorf("invalid token: %v", err)
// 	}

// 	// Validate the token
// 	if !token.Valid {
// 		return nil, errors.New("invalid token")
// 	}

// 	// Verify token type
// 	claims, ok := token.Claims.(jwt.MapClaims)
// 	if !ok {
// 		return nil, errors.New("invalid token claims")
// 	}

// 	// Check if this is a client token
// 	tokenType, ok := claims["type"].(string)
// 	if !ok || tokenType != "client" {
// 		return nil, errors.New("invalid token type, expected client token")
// 	}

// 	// Verify required claims
// 	if _, ok := claims["client_id"].(string); !ok {
// 		return nil, errors.New("missing client_id in token")
// 	}

// 	if _, ok := claims["app_id"].(string); !ok {
// 		return nil, errors.New("missing app_id in token")
// 	}

// 	return token, nil
// }

// // extractToken extracts the token from the Authorization header
// func (s *authService) extractToken(authHeader string) (string, error) {
// 	parts := strings.SplitN(authHeader, " ", 2)
// 	if len(parts) != 2 || parts[0] != "Bearer" {
// 		return "", errors.New("authorization header format must be 'Bearer {token}'")
// 	}

// 	return parts[1], nil
// }
