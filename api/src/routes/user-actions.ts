import { routeModule } from "./context";
import type * as treat from "@woofx3/db/treat.pb";
import type * as user from "@woofx3/db/user.pb";
import * as protoscript from "protoscript";
import { timestampFromDate } from "./helpers";

export const userActionsRoutes = routeModule({
  async getUserProfile(userId: string): Promise<{
    id: string;
    username: string;
    treats: {
      total: number;
      points: number;
    };
    stats?: Record<string, unknown>;
  }> {
    // Get user
    const userReq: user.GetUserRequest = {
      id: userId,
    };
    const userResponse = await this.db.getUser(userReq);
    if (userResponse.status?.code !== "OK" || !userResponse.user) {
      throw new Error("User not found");
    }

    // Get treats summary (last 30 days)
    const applicationId = await this.ensureApplicationId();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const treatsReq: treat.GetUserTreatsSummaryRequest = {
      userId,
      applicationId,
      fromDate: timestampFromDate(thirtyDaysAgo),
      toDate: timestampFromDate(now),
    };
    const treatsResponse = await this.db.getUserTreatsSummary(treatsReq);
    const treatsSummary = treatsResponse.summary;

    return {
      id: userResponse.user.id,
      username: userResponse.user.username,
      treats: {
        total: treatsSummary?.totalTreats || 0,
        points: treatsSummary?.totalPoints || 0,
      },
    };
  },

  /**
   * Award treats to a user (UI action).
   */
  async awardTreatsToUser(
    userId: string,
    treatType: string,
    title: string,
    description: string,
    points: number,
    awardedBy: string,
    imageUrl: string = "",
    expiresInDays?: number
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const expiresAt = expiresInDays
      ? timestampFromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000))
      : protoscript.Timestamp.initialize();

    const applicationId = await this.ensureApplicationId();
    const req: treat.AwardTreatRequest = {
      userId,
      treatType,
      title,
      description,
      points,
      imageUrl,
      awardedBy,
      applicationId,
      metadata: {},
      expiresAt,
    };
    const response = await this.db.awardTreat(req);
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "Failed to award treat");
    }

    return {
      success: true,
      message: `Awarded treat "${title}" to user`,
    };
  }
});
