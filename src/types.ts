// --- Inoreader API Response Types ---

export interface InoreaderUserInfo {
	userId: string;
	userName: string;
	userProfileId: string;
	userEmail: string;
}

export interface InoreaderAnnotation {
	id: number;
	start: number;
	end: number;
	added_on: number;
	text: string;
	note: string;
}

export interface InoreaderArticleOrigin {
	streamId: string;
	title: string;
	htmlUrl: string;
}

export interface InoreaderArticle {
	id: string;
	title: string;
	author: string;
	published: number;
	updated: number;
	crawlTimeMsec: string;
	timestampUsec: string;
	canonical?: { href: string }[];
	alternate?: { href: string; type: string }[];
	summary?: { direction: string; content: string };
	categories: string[];
	origin: InoreaderArticleOrigin;
	annotations?: InoreaderAnnotation[];
}

export interface InoreaderStreamContentsResponse {
	direction: string;
	id: string;
	title: string;
	continuation?: string;
	items: InoreaderArticle[];
}

export interface InoreaderSubscription {
	id: string;
	title: string;
	categories: { id: string; label: string }[];
	url: string;
	htmlUrl: string;
	iconUrl: string;
}

export interface InoreaderSubscriptionListResponse {
	subscriptions: InoreaderSubscription[];
}

export interface InoreaderTag {
	id: string;
	type?: string;
	unread_count?: number;
}

export interface InoreaderTagListResponse {
	tags: InoreaderTag[];
}

export interface InoreaderUnreadCount {
	id: string;
	count: number;
	newestItemTimestampUsec: string;
}

export interface InoreaderUnreadCountResponse {
	max: number;
	unreadcounts: InoreaderUnreadCount[];
}

// --- Internal Plugin Types ---

export interface HighlightData {
	id: number;
	text: string;
	note: string;
	addedOn: string;
}

export interface ArticleData {
	id: string;
	title: string;
	author: string;
	url: string;
	publishedDate: string;
	feedTitle: string;
	feedUrl: string;
	tags: string[];
	highlights: HighlightData[];
	htmlContent: string;
	isStarred: boolean;
}

export interface OAuthTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
}
