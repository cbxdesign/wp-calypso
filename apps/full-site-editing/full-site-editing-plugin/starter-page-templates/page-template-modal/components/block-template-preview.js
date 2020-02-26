/**
 * External dependencies
 */
import { castArray, noop } from 'lodash';

/**
 * WordPress dependencies
 */
/* eslint-disable import/no-extraneous-dependencies */
import { Disabled } from '@wordpress/components';
import { BlockEditorProvider, BlockList } from '@wordpress/block-editor';
import { useMemo,  useLayoutEffect,  useReducer } from '@wordpress/element';
import { withSelect } from '@wordpress/data';
/* eslint-enable import/no-extraneous-dependencies */

/**
 * Internal dependencies
 */
import BlockFramePreview from './template-preview-frame';

function _BlockPreview( {
	blocks,
	settings,
} ) {
	const renderedBlocks = useMemo( () => castArray( blocks ), [ blocks ] );
	const [ recompute, triggerRecompute ] = useReducer( state => state + 1, 0 );

	useLayoutEffect( triggerRecompute, [ blocks ] );

	return (
		<BlockEditorProvider value={ renderedBlocks } settings={ settings }>
			<Disabled key={ recompute }>
				<BlockList />
			</Disabled>
		</BlockEditorProvider>
	);
}


const BlockTemplatePreview = ( { blocks = [], viewportWidth } ) => {
	return (
		/* eslint-disable wpcalypso/jsx-classname-namespace */
		<BlockFramePreview
			viewportWidth={ viewportWidth }
			blocks={ blocks }
		/>
		/* eslint-enable wpcalypso/jsx-classname-namespace */

		/*
		<BlockFramePreview viewportWidth={ viewportWidth }>
			<BlockPreview blocks={ blocks } viewportWidth={ viewportWidth } />
		</BlockFramePreview>
		 */
	);
};

export default BlockTemplatePreview;
