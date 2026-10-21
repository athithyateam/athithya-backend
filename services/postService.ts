/**
 * Post Service - Unified Façade
 * Aggregates and re-exports post actions and reactions sub-services
 * using the Singleton pattern with Dependency Injection.
 */

import { 
    PostActionService, 
    postActionService as defaultPostActionService,
    GetPostsOptions,
    PaginatedPostsResult,
    PostDetailResult,
    GetTopRatedTreksOptions,
    TopRatedTreksResult,
    GetNearbyTreksOptions,
    NearbyTreksResult,
    GetPendingPostsOptions,
    CategoryActivityResult
} from "./posts/postActionService";
import { PostReactionService, postReactionService as defaultPostReactionService, ReactToPostResult, ReactionStatsResult, ReactionItem } from "./posts/postReactionService";
import { calculatePricingAndFees, isValidS3MediaUrl, parsePostPayload } from "./posts/postPayloadParser";

export {
    ReactToPostResult,
    ReactionStatsResult,
    ReactionItem,
    PostActionService,
    PostReactionService,
    GetPostsOptions,
    PaginatedPostsResult,
    PostDetailResult,
    GetTopRatedTreksOptions,
    TopRatedTreksResult,
    GetNearbyTreksOptions,
    NearbyTreksResult,
    GetPendingPostsOptions,
    CategoryActivityResult,
    calculatePricingAndFees,
    isValidS3MediaUrl,
    parsePostPayload
};

export class PostService {
    private static instance: PostService | null = null;
    private static instanceKey = Symbol("PostServiceInstanceKey");

    public actionService: PostActionService;
    public reactionService: PostReactionService;

    constructor(
        instanceKey: symbol,
        actionService: PostActionService = defaultPostActionService,
        reactionService: PostReactionService = defaultPostReactionService
    ) {
        if (instanceKey !== PostService.instanceKey) {
            throw new Error("Please use PostService.getInstance() to retrieve or create an instance");
        }
        this.actionService = actionService;
        this.reactionService = reactionService;
    }

    public static getInstance(
        actionService?: PostActionService,
        reactionService?: PostReactionService
    ): PostService {
        if (!this.instance) {
            this.instance = new PostService(this.instanceKey, actionService, reactionService);
        }
        return this.instance;
    }

    // Action Sub-Service Delegations
    public async createPost(userId: string, userRole: string, postPayload: any, files?: any, reqOrApp?: any): Promise<any> {
        return this.actionService.createPost(userId, userRole, postPayload, files, reqOrApp);
    }

    public async updatePost(postId: string, userId: string, userRole: string, updatePayload: any, files?: any, reqOrApp?: any): Promise<any> {
        return this.actionService.updatePost(postId, userId, userRole, updatePayload, files, reqOrApp);
    }

    public async updatePostStatus(postId: string, status: string, remarks?: string): Promise<any> {
        return this.actionService.updatePostStatus(postId, status, remarks);
    }

    public async toggleHideExperience(postId: string, userId: string, userRole: string, action: string, reason?: string, reqOrApp?: any): Promise<any> {
        return this.actionService.toggleHideExperience(postId, userId, userRole, action, reason, reqOrApp);
    }

    public async deletePost(postId: string, userId: string, userRole: string, reqOrApp?: any): Promise<{ success: boolean; message: string; pendingReview?: boolean }> {
        return this.actionService.deletePost(postId, userId, userRole, reqOrApp);
    }

    public async savePost(postId: string, userId: string, userRole: string): Promise<{ success: boolean; message: string }> {
        return this.actionService.savePost(postId, userId, userRole);
    }

    public async unsavePost(postId: string, userId: string): Promise<{ success: boolean; message: string }> {
        return this.actionService.unsavePost(postId, userId);
    }

    // Query Delegations
    public async getPosts(options?: GetPostsOptions): Promise<PaginatedPostsResult> {
        return this.actionService.getPosts(options);
    }

    public async getPostDetail(postId: string): Promise<PostDetailResult> {
        return this.actionService.getPostDetail(postId);
    }

    public async getTopRatedTreks(options?: GetTopRatedTreksOptions): Promise<TopRatedTreksResult> {
        return this.actionService.getTopRatedTreks(options);
    }

    public async getNearbyTreks(options?: GetNearbyTreksOptions): Promise<NearbyTreksResult> {
        return this.actionService.getNearbyTreks(options);
    }

    public async getUserPosts(userId: string, postType?: string): Promise<any[]> {
        return this.actionService.getUserPosts(userId, postType);
    }

    public async getPendingPosts(options?: GetPendingPostsOptions): Promise<PaginatedPostsResult> {
        return this.actionService.getPendingPosts(options);
    }

    public async getCategoryActivity(): Promise<CategoryActivityResult[]> {
        return this.actionService.getCategoryActivity();
    }

    // Reaction Sub-Service Delegations
    public async reactToPost(postId: string, userId: string, emoji: string): Promise<ReactToPostResult> {
        return this.reactionService.reactToPost(postId, userId, emoji);
    }

    public async getReactionStats(postId: string, currentUserId: string | null = null): Promise<ReactionStatsResult> {
        return this.reactionService.getReactionStats(postId, currentUserId);
    }

    public async getPostReviews(postId: string): Promise<any[]> {
        return this.reactionService.getPostReviews(postId);
    }
}

export const postService = PostService.getInstance();
export default PostService;

// Convenience function exports for backward compatibility
export const createPost = (userId: string, userRole: string, postPayload: any, files?: any, reqOrApp?: any) => postService.createPost(userId, userRole, postPayload, files, reqOrApp);
export const updatePost = (postId: string, userId: string, userRole: string, updatePayload: any, files?: any, reqOrApp?: any) => postService.updatePost(postId, userId, userRole, updatePayload, files, reqOrApp);
export const updatePostStatus = (postId: string, status: string, remarks?: string) => postService.updatePostStatus(postId, status, remarks);
export const toggleHideExperience = (postId: string, userId: string, userRole: string, action: string, reason?: string, reqOrApp?: any) => postService.toggleHideExperience(postId, userId, userRole, action, reason, reqOrApp);
export const deletePost = (postId: string, userId: string, userRole: string, reqOrApp?: any) => postService.deletePost(postId, userId, userRole, reqOrApp);
export const savePost = (postId: string, userId: string, userRole: string) => postService.savePost(postId, userId, userRole);
export const unsavePost = (postId: string, userId: string) => postService.unsavePost(postId, userId);
export const getPosts = (options?: GetPostsOptions) => postService.getPosts(options);
export const getPostDetail = (postId: string) => postService.getPostDetail(postId);
export const getTopRatedTreks = (options?: GetTopRatedTreksOptions) => postService.getTopRatedTreks(options);
export const getNearbyTreks = (options?: GetNearbyTreksOptions) => postService.getNearbyTreks(options);
export const getUserPosts = (userId: string, postType?: string) => postService.getUserPosts(userId, postType);
export const getPendingPosts = (options?: GetPendingPostsOptions) => postService.getPendingPosts(options);
export const getCategoryActivity = () => postService.getCategoryActivity();
export const reactToPost = (postId: string, userId: string, emoji: string) => postService.reactToPost(postId, userId, emoji);
export const getReactionStats = (postId: string, currentUserId?: string | null) => postService.getReactionStats(postId, currentUserId);
export const getPostReviews = (postId: string) => postService.getPostReviews(postId);

// CommonJS compatibility
module.exports = postService;
module.exports.PostService = PostService;
module.exports.postService = postService;
module.exports.createPost = createPost;
module.exports.updatePost = updatePost;
module.exports.updatePostStatus = updatePostStatus;
module.exports.toggleHideExperience = toggleHideExperience;
module.exports.deletePost = deletePost;
module.exports.savePost = savePost;
module.exports.unsavePost = unsavePost;
module.exports.getPosts = getPosts;
module.exports.getPostDetail = getPostDetail;
module.exports.getTopRatedTreks = getTopRatedTreks;
module.exports.getNearbyTreks = getNearbyTreks;
module.exports.getUserPosts = getUserPosts;
module.exports.getPendingPosts = getPendingPosts;
module.exports.getCategoryActivity = getCategoryActivity;
module.exports.reactToPost = reactToPost;
module.exports.getReactionStats = getReactionStats;
module.exports.getPostReviews = getPostReviews;
module.exports.default = PostService;
