/**
 * Post Handler - Main Entry Point
 * This file is now modularized into smaller units in the ./posts directory.
 */

const { createPost } = require("./posts/postCreate");
const { updatePost, updatePostStatus, requestHidePost } = require("./posts/postUpdate");
const { deletePost } = require("./posts/postDelete");
const { 
    getPosts, 
    getPostDetail, 
    getTopRatedTreks, 
    getNearbyTreks, 
    getUserPosts, 
    getPendingPosts,
    getCategoryActivity
} = require("./posts/postQuery");
const { reactToPost, getReactionStats, getPostReviews } = require("./posts/postReaction");
const { getPresignedUrl } = require("./posts/postPresigned");
const { savePost, unsavePost } = require("./posts/postSave");

module.exports = {
    createPost,
    updatePost,
    updatePostStatus,
    requestHidePost,
    deletePost,
    getPosts,
    getPostDetail,
    getTopRatedTreks,
    getNearbyTreks,
    getUserPosts,
    getPendingPosts,
    getCategoryActivity,
    reactToPost,
    getReactionStats,
    getPostReviews,
    getPresignedUrl,
    savePost,
    unsavePost
};
