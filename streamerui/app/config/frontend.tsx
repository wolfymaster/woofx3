import ThirdPartyReact from "supertokens-auth-react/recipe/thirdparty/index.js";
import Session from "supertokens-auth-react/recipe/session/index.js";
import { appInfo } from "./appInfo";
import { SuperTokensConfig } from "supertokens-auth-react/lib/build/types";
import { ThirdPartyPreBuiltUI } from "supertokens-auth-react/recipe/thirdparty/prebuiltui.js";

export const frontendConfig = (): SuperTokensConfig => {
    return {
        appInfo,
        recipeList: [
            ThirdPartyReact.init({
                signInAndUpFeature: {
                    providers: [
                        {
                            id: 'twitch',
                            name: 'Twitch',
                            buttonComponent: () => <div style={{ cursor: 'pointer', background: '#6441a5', color: 'white', padding: '10px' }}>Login with Twitch</div>
                        }
                    ],
                },
            }),
            Session.init(),
        ],
    };
};

export const recipeDetails = {
    docsLink: "https://supertokens.com/docs/thirdparty/introduction",
};

export const PreBuiltUIList = [ThirdPartyPreBuiltUI];
