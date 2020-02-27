/**
 * External dependencies
 */
import store from 'store';
import { assign, clone, get, includes, isEmpty, pick, reduce } from 'lodash';

/**
 * Internal dependencies
 */
import wpcom from 'lib/wp';
import { decodeEntities } from 'lib/formatting';
import { getSitePost, getEditedPost, getPostEdits, isEditedPostDirty } from 'state/posts/selectors';
import { recordSaveEvent } from 'state/posts/stats';
import {
	getFeaturedImageId,
	isBackDated,
	isFutureDated,
	isPublished,
	normalizeTermsForApi,
} from 'state/posts/utils';
import editedPostHasContent from 'state/selectors/edited-post-has-content';
import {
	startEditingPost,
	startEditingNewPost,
	editorAutosave,
	editorAutosaveReset,
	editorLoadingErrorReset,
	editorSetLoadingError,
	editorInitRawContent,
	editorSave,
} from 'state/ui/editor/actions';
import {
	getEditorPostId,
	getEditorInitialRawContent,
	getEditorRawContent,
	isEditorSaveBlocked,
} from 'state/ui/editor/selectors';
import { setEditorLastDraft, resetEditorLastDraft } from 'state/ui/editor/last-draft/actions';
import { getSelectedSiteId } from 'state/ui/selectors';
import { getPreference } from 'state/preferences/selectors';

import 'state/posts/init';

import { receivePost } from 'state/posts/actions/receive-post';
import { savePostSuccess } from 'state/posts/actions/save-post-success';
import { normalizePost } from 'state/posts/actions/normalize-post';

export { receivePosts } from 'state/posts/actions/receive-posts';
export { receivePost } from 'state/posts/actions/receive-post';
export { requestSitePosts } from 'state/posts/actions/request-site-posts';
export { requestAllSitesPosts } from 'state/posts/actions/request-all-sites-posts';
export { requestSitePost } from 'state/posts/actions/request-site-post';
export { editPost } from 'state/posts/actions/edit-post';
export { updatePostMetadata } from 'state/posts/actions/update-post-metadata';
export { deletePostMetadata } from 'state/posts/actions/delete-post-metadata';
export { savePostSuccess } from 'state/posts/actions/save-post-success';
export { savePost } from 'state/posts/actions/save-post';
export { trashPost } from 'state/posts/actions/trash-post';
export { deletePost } from 'state/posts/actions/delete-post';
export { restorePost } from 'state/posts/actions/restore-post';
export { addTermForPost } from 'state/posts/actions/add-term-for-post';
export { startEditingExistingPost } from 'state/posts/actions/start-editing-existing-post';

/**
 * Normalizes attributes to API expectations
 *
 * @param  {object} attributes - changed attributes
 * @returns {object} - normalized attributes
 */
function normalizeApiAttributes( attributes ) {
	attributes = clone( attributes );
	attributes = normalizeTermsForApi( attributes );

	if ( attributes.author ) {
		attributes.author = attributes.author.ID;
	}

	return attributes;
}

export const startEditingPostCopy = ( siteId, postToCopyId ) => dispatch => {
	dispatch( startEditingPost( siteId, null ) );

	wpcom
		.site( siteId )
		.post( postToCopyId )
		.get( { context: 'edit' } )
		.then( postToCopy => {
			const postAttributes = pick( postToCopy, [
				'canonical_image',
				'content',
				'excerpt',
				'format',
				'post_thumbnail',
				'terms',
				'type',
			] );

			postAttributes.title = decodeEntities( postToCopy.title );
			postAttributes.featured_image = getFeaturedImageId( postToCopy );

			/**
			 * A post metadata whitelist for the `updatePostMetadata()` action.
			 *
			 * This is needed because blindly passing all post metadata to `editPost()`
			 * causes unforeseeable issues, such as Publicize not triggering on the copied post.
			 *
			 * @see https://github.com/Automattic/wp-calypso/issues/14840
			 */
			const metadataWhitelist = [ 'geo_latitude', 'geo_longitude', 'geo_address', 'geo_public' ];

			// Filter the post metadata to include only the ones we want to copy,
			// use only the `key` and `value` properties (and, most importantly exclude `id`),
			// and add an `operation` field to the copied values.
			const copiedMetadata = reduce(
				postToCopy.metadata,
				( copiedMeta, { key, value } ) => {
					if ( includes( metadataWhitelist, key ) ) {
						copiedMeta.push( { key, value, operation: 'update' } );
					}
					return copiedMeta;
				},
				[]
			);

			if ( copiedMetadata.length > 0 ) {
				postAttributes.metadata = copiedMetadata;
			}

			dispatch( startEditingNewPost( siteId, postAttributes ) );
		} )
		.catch( error => {
			dispatch( editorSetLoadingError( error ) );
		} );
};

let saveMarkerId = 0;

/*
 * Calls out to API to save a Post object
 *
 * @param {object} options object with optional recordSaveEvent property. True if you want to record the save event.
 */
export const saveEdited = options => async ( dispatch, getState ) => {
	const siteId = getSelectedSiteId( getState() );
	const postId = getEditorPostId( getState() );
	const post = getEditedPost( getState(), siteId, postId );

	// Don't send a request to the API if the post has no content (title,
	// content, or excerpt). A post without content is invalid.
	if ( ! editedPostHasContent( getState(), siteId, postId ) ) {
		throw new Error( 'NO_CONTENT' );
	}

	// Prevent saving post if another module has blocked saving.
	if ( isEditorSaveBlocked( getState() ) ) {
		throw new Error( 'SAVE_BLOCKED' );
	}

	const initialRawContent = getEditorInitialRawContent( getState() );
	const rawContent = getEditorRawContent( getState() );

	let changedAttributes = getPostEdits( getState(), siteId, postId );

	// when toggling editor modes, it is possible for the post to be dirty
	// even though the content hasn't changed. To avoid a confusing UX
	// let's just pass the content through and save it anyway
	if ( ! get( changedAttributes, 'content' ) && rawContent !== initialRawContent ) {
		changedAttributes = {
			...changedAttributes,
			content: post.content,
		};
	}

	// Don't send a request to the API if the post is unchanged. An empty post request is invalid.
	// This case is not treated as error, but rather as a successful save.
	if ( isEmpty( changedAttributes ) ) {
		return null;
	}

	const saveMarker = `save-marker-${ ++saveMarkerId }`;
	dispatch( editorSave( siteId, postId, saveMarker ) );

	changedAttributes = normalizeApiAttributes( changedAttributes );
	const mode = getPreference( getState(), 'editor-mode' );
	const isNew = ! postId;

	const postHandle = wpcom.site( siteId ).post( postId );
	const query = {
		context: 'edit',
		apiVersion: '1.2',
	};
	if ( options && options.autosave ) {
		query.autosave = options.autosave;
	}

	if ( ! options || options.recordSaveEvent !== false ) {
		dispatch( recordSaveEvent() ); // do this before changing status from 'future'
	}

	if (
		( changedAttributes && changedAttributes.status === 'future' && isFutureDated( post ) ) ||
		( changedAttributes && changedAttributes.status === 'publish' && isBackDated( post ) )
	) {
		// HACK: This is necessary because for some reason v1.1 and v1.2 of the update post endpoints
		// don't accept a status of 'future' under any conditions.
		// We also need to make sure that we send the date so that the post isn't published.

		// HACK^2: If a post is back-dated, we must also pass in the date, otherwise the API resets the date
		// here /public.api/rest/json-endpoints/class.wpcom-json-api-update-post-v1-2-endpoint.php#L102
		changedAttributes = assign( {}, changedAttributes, {
			status: 'publish',
			date: post.date,
		} );
	}

	const data = await postHandle[ isNew ? 'add' : 'update' ]( query, changedAttributes );

	const currentMode = getPreference( getState(), 'editor-mode' );

	dispatch( editorAutosaveReset() );
	dispatch( editorLoadingErrorReset() );

	// Retrieve the normalized post and use it to update Redux store
	const receivedPost = normalizePost( data );

	if ( receivedPost.status === 'draft' ) {
		// If a draft was successfully saved, set it as "last edited draft"
		// There's UI in masterbar for one-click "continue editing"
		dispatch( setEditorLastDraft( receivedPost.site_ID, receivedPost.ID ) );
	} else {
		// Draft was published or trashed: reset the "last edited draft" record
		dispatch( resetEditorLastDraft() );
	}

	// `post.ID` can be null/undefined, which means we're saving new post.
	// `savePostSuccess` will convert the temporary ID (empty string key) in Redux
	// to the newly assigned ID in `receivedPost.ID`.
	dispatch( savePostSuccess( receivedPost.site_ID, post.ID, receivedPost, {} ) );
	dispatch( receivePost( receivedPost, saveMarker ) );

	// Only re-init the rawContent if the mode hasn't changed since the request was initiated.
	// Changing the mode re-initializes the rawContent, so we don't want to stomp on it
	if ( mode === currentMode ) {
		dispatch( editorInitRawContent( rawContent ) );
	}

	/*
	 * Return a "save result" object that contains the received post object and a boolean
	 * flag that tells whether a post ID was assigned during this save. Happens when a new draft
	 * has been just saved for the first time.
	 */
	return {
		receivedPost,
		idAssigned: post.ID !== receivedPost.ID,
	};
};

export const autosave = () => async ( dispatch, getState ) => {
	const state = getState();

	const siteId = getSelectedSiteId( state );
	const postId = getEditorPostId( state );

	if ( ! isEditedPostDirty( state, siteId, postId ) ) {
		return null;
	}

	const savedPost = getSitePost( state, siteId, postId );
	const post = getEditedPost( state, siteId, postId );

	store.set( 'wpcom-autosave:' + siteId + ':' + postId, post );

	// TODO: incorporate post locking
	if ( isPublished( savedPost ) || isPublished( post ) ) {
		await dispatch( editorAutosave( post ) );
		return null;
	}

	return await dispatch( saveEdited( { recordSaveEvent: false, autosave: true } ) );
};
