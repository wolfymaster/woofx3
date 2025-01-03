import { CelebrateIcon, SeparatorLine, BlogsIcon, GuideIcon, SignOutIcon } from "../../assets/images";
import { recipeDetails } from "../config/frontend";
import SuperTokens from "supertokens-auth-react";
import { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import SessionReact from "supertokens-auth-react/recipe/session/index.js";
import { getSessionForSSR } from "supertokens-node/custom";
import { TryRefreshComponent } from "../components/tryRefreshClientComponent";
import { SessionAuthForRemix } from "../components/sessionAuthForRemix";
import type { JWTPayload } from "jose";
import { useEffect, useState } from "react";


// export async function loader({ request }: LoaderFunctionArgs) {
//     const userResponse = await fetch("https://auth.local.woofx3.tv/woofx3/user", {
//         method: "GET",
//         headers: {
//             Cookie: request.headers.get("Cookie") || "",
//         },
//     });

//     console.log('userResponse', userResponse);

// }

export default function Home() {
    const [userInfo, setUserInfo] = useState(null);

    useEffect(() => {
        const fetchUserInfo = async () => {
            try {
                // Check if the session exists
                const sessionExists = await SessionReact.doesSessionExist();
                if (!sessionExists) {
                    console.log("No active session");
                    return;
                }

                // Get session payload
                const payload = await SessionReact.getAccessTokenPayloadSecurely();

                console.log('payload', payload);

                // Extract user information (e.g., email, userId)
                setUserInfo({
                    email: payload.email, // Replace with your claim key
                    userId: payload.userId,
                });
            } catch (err) {
                console.error("Error fetching user info:", err);
            }
        }

        fetchUserInfo();
    }, []);

    async function logoutClicked() {
        await SessionReact.signOut();
        SuperTokens.redirectToAuth();
    }

    const fetchUserData = async () => {
        const userInfoResponse = await fetch("https://auth.local.woofx3.tv/auth/");

        const body = await userInfoResponse.json();

        console.log(body);

        alert(JSON.stringify(body));
    };

    const links: {
        name: string;
        link: string;
        icon: string;
    }[] = [
        {
            name: "Blogs",
            link: "https://supertokens.com/blog",
            icon: BlogsIcon,
        },
        {
            name: "Guides",
            link: recipeDetails.docsLink,
            icon: GuideIcon,
        },
        {
            name: "Sign Out",
            link: "",
            icon: SignOutIcon,
        },
    ];

    /**
     * SessionAuthForRemix will handle proper redirection for the user based on the different session states.
     * It will redirect to the login page if the session does not exist etc.
     */
    return (
        <SessionAuthForRemix>
            <div className="homeContainer">
                <div className="mainContainer">
                    <div className="topBand successTitle bold500">
                        <img src={CelebrateIcon} alt="Login successful" className="successIcon" />
                        Login successful
                    </div>
                    <div className="innerContent">
                        <div>Your userID is: </div>

                        {/* <div className="truncate userId">{accessTokenPayload.sub}</div> */}

                        <button onClick={() => fetchUserData()} className="sessionButton">
                            Call API
                        </button>
                    </div>
                </div>

                <div className="bottomLinksContainer">
                    {links.map((link) => {
                        if (link.name === "Sign Out") {
                            return (
                                <button
                                    key={link.name}
                                    className="linksContainerLink signOutLink"
                                    onClick={logoutClicked}
                                >
                                    <img src={link.icon} alt={link.name} className="linkIcon" />
                                    <div role="button">{link.name}</div>
                                </button>
                            );
                        }
                        return (
                            <a href={link.link} className="linksContainerLink" key={link.name}>
                                <img src={link.icon} alt={link.name} className="linkIcon" />
                                <div role="button">{link.name}</div>
                            </a>
                        );
                    })}
                </div>

                <img className="separatorLine" src={SeparatorLine} alt="separator" />
            </div>
        </SessionAuthForRemix>
    );
}
