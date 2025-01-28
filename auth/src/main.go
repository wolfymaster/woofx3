package main

import (
	"net/http"
	"os"
	"strings"

	"github.com/supertokens/supertokens-golang/recipe/session"
	"github.com/supertokens/supertokens-golang/recipe/session/sessmodels"
	"github.com/supertokens/supertokens-golang/recipe/thirdparty"
	"github.com/supertokens/supertokens-golang/recipe/thirdparty/tpmodels"
	"github.com/supertokens/supertokens-golang/supertokens"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	_ "github.com/joho/godotenv/autoload"
)

func main() {
	godotenv.Load("../.env")

	apiBasePath := os.Getenv("SUPERTOKENS_API_BASEPATH")
	websiteBasePath := os.Getenv("SUPERTOKENS_WEBSITE_BASEPATH")
	cookieDomain := os.Getenv("SUPERTOKENS_COOKIE_DOMAIN")
	port := os.Getenv("AUTH_PORT")

	err := supertokens.Init(supertokens.TypeInput{
		Supertokens: &supertokens.ConnectionInfo{
			ConnectionURI: os.Getenv("SUPERTOKENS_CONNECTION_URI"),
			APIKey:        os.Getenv("SUPERTOKENS_API_KEY"),
		},
		AppInfo: supertokens.AppInfo{
			AppName:   "woofwoofwoof",
			APIDomain: os.Getenv("SUPERTOKENS_API_DOMAIN"),
			WebsiteDomain: os.Getenv("SUPERTOKENS_WEBSITE_DOMAIN"),
			APIBasePath:     &apiBasePath,
			WebsiteBasePath: &websiteBasePath,
		},
		RecipeList: []supertokens.Recipe{
			session.Init(&sessmodels.TypeInput{
				CookieDomain: &cookieDomain,
			}),
			thirdparty.Init(&tpmodels.TypeInput{
				SignInAndUpFeature: tpmodels.TypeInputSignInAndUp{
					Providers: []tpmodels.ProviderInput{
						{
							Config: tpmodels.ProviderConfig{
								ThirdPartyId: "twitch",
								Name:         "Twitch provider",
								Clients: []tpmodels.ProviderClientConfig{
									{
										ClientID:     os.Getenv("TWITCH_WOLFY_CLIENT_ID"),
										ClientSecret: os.Getenv("TWITCH_WOLFY_CLIENT_SECRET"),
										Scope:        []string{"openid", "user:read:email", "user:read:follows", "user:read:subscriptions"},
									},
								},
								OIDCDiscoveryEndpoint: "https://id.twitch.tv/oauth2/.well-known/openid-configuration",
								AuthorizationEndpointQueryParams: map[string]interface{}{
									"claims": `{"id_token":{"email":null,"email_verified":null},"userinfo":{"picture":null}}`,
									"state":  "mountaindew",
								},
								UserInfoMap: tpmodels.TypeUserInfoMap{
									FromIdTokenPayload: tpmodels.TypeUserInfoMapFields{
										UserId:        "sub",
										Email:         "email",
										EmailVerified: "email_verified",
									},
								},
							},
						},
					},
				},
			}),
		},
	})

	if err != nil {
		panic(err.Error())
	}

	// setup gin
	router := gin.New()

	// CORS
	allowedDomains := strings.Split(os.Getenv("ALLOWED_ORIGIN_DOMAINS"), "|")
	router.Use(cors.New(cors.Config{
		AllowOriginFunc: func(origin string) bool {
			for _, domain := range allowedDomains {
				if strings.HasSuffix(origin, "."+domain) || origin == "https://"+domain {
					return true
				}
			}
			return false
		},
		AllowMethods:     []string{"GET", "POST", "DELETE", "PUT", "OPTIONS"},
		AllowHeaders:     append([]string{"content-type"}, supertokens.GetAllCORSHeaders()...),
		AllowCredentials: true,
	}))

	// Adding the SuperTokens middleware
	router.Use(func(c *gin.Context) {
		supertokens.Middleware(http.HandlerFunc(
			func(rw http.ResponseWriter, r *http.Request) {
				c.Next()
			})).ServeHTTP(c.Writer, c.Request)
		// we call Abort so that the next handler in the chain is not called, unless we call Next explicitly
		c.Abort()
	})

	// start the server
	router.Run(":" + port)
}
