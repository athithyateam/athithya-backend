const { Post, User, Review } = require("../../db/mongoose");

export interface ReactionItem {
    user: any;
    name: string;
    emoji: string;
    timestamp?: number;
}

export interface ReactToPostResult {
    action: "added" | "removed" | "updated";
    reactions: ReactionItem[];
    reactionStats: Record<string, number>;
    totalReactions: number;
    userReaction: string | null;
}

export interface ReactionStatsResult {
    totalReactions: number;
    reactionStats: Record<string, { count: number; users: any[] }>;
    userReaction: string | null;
    allReactions: ReactionItem[];
}

export class PostReactionService {
    private static instance: PostReactionService | null = null;
    private static instanceKey = Symbol("PostReactionServiceInstanceKey");

    private postModel: any;
    private userModel: any;
    private reviewModel: any;

    constructor(
        instanceKey: symbol,
        postModel: any = Post,
        userModel: any = User,
        reviewModel: any = Review
    ) {
        if (instanceKey !== PostReactionService.instanceKey) {
            throw new Error("Please use PostReactionService.getInstance() to retrieve or create an instance");
        }
        this.postModel = postModel;
        this.userModel = userModel;
        this.reviewModel = reviewModel;
    }

    public static getInstance(
        postModel?: any,
        userModel?: any,
        reviewModel?: any
    ): PostReactionService {
        if (!this.instance) {
            this.instance = new PostReactionService(this.instanceKey, postModel, userModel, reviewModel);
        }
        return this.instance;
    }

    /**
     * Service: React to a post (add, remove, or change emoji)
     * Positional parameters: (postId, userId, emoji)
     */
    public async reactToPost(postId: string, userId: string, emoji: string): Promise<ReactToPostResult> {
        if (!emoji) {
            const error: any = new Error("Emoji is required");
            error.statusCode = 400;
            throw error;
        }

        const post = await this.postModel.findById(postId);
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        const user = await this.userModel.findById(userId);
        const userName = user ? `${user.firstname} ${user.lastname}` : "Someone";

        const existingIndex = post.reactions.findIndex((r: any) => r.user.toString() === userId.toString());
        let action: "added" | "removed" | "updated" = "added";

        if (existingIndex > -1) {
            if (post.reactions[existingIndex].emoji === emoji) {
                post.reactions.splice(existingIndex, 1);
                action = "removed";
            } else {
                post.reactions[existingIndex].emoji = emoji;
                post.reactions[existingIndex].timestamp = Date.now();
                action = "updated";
            }
        } else {
            post.reactions.push({ user: userId, name: userName, emoji });
        }

        await post.save();

        const reactionStats: Record<string, number> = {};
        post.reactions.forEach((r: any) => {
            reactionStats[r.emoji] = (reactionStats[r.emoji] || 0) + 1;
        });

        return {
            action,
            reactions: post.reactions,
            reactionStats,
            totalReactions: post.reactions.length,
            userReaction: action === "removed" ? null : emoji
        };
    }

    /**
     * Service: Get aggregated reaction statistics for a post
     * Positional parameters: (postId, currentUserId)
     */
    public async getReactionStats(postId: string, currentUserId: string | null = null): Promise<ReactionStatsResult> {
        const post = await this.postModel.findById(postId).select("reactions");
        if (!post) {
            const error: any = new Error("Post not found");
            error.statusCode = 404;
            throw error;
        }

        const reactionStats: Record<string, { count: number; users: any[] }> = {};
        const reactions: ReactionItem[] = post.reactions || [];
        reactions.forEach((r: any) => {
            if (!reactionStats[r.emoji]) reactionStats[r.emoji] = { count: 0, users: [] };
            reactionStats[r.emoji].count++;
            reactionStats[r.emoji].users.push({ userId: r.user, name: r.name, timestamp: r.timestamp });
        });

        let userReaction: string | null = null;
        if (currentUserId) {
            const ur = reactions.find((r: any) => r.user.toString() === currentUserId.toString());
            if (ur) userReaction = ur.emoji;
        }

        return {
            totalReactions: reactions.length,
            reactionStats,
            userReaction,
            allReactions: reactions
        };
    }

    /**
     * Service: Get reviews for a post
     * Positional parameter: (postId)
     */
    public async getPostReviews(postId: string): Promise<any[]> {
        return await this.reviewModel.find({ post: postId })
            .populate("reviewer", "firstname lastname avatar role")
            .sort({ createdAt: -1 });
    }
}

export const postReactionService = PostReactionService.getInstance();
export default PostReactionService;

module.exports = postReactionService;
module.exports.PostReactionService = PostReactionService;
module.exports.postReactionService = postReactionService;
module.exports.default = PostReactionService;
