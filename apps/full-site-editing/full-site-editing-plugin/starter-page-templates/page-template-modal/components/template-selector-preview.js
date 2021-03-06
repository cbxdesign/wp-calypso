/**
 * WordPress dependencies
 */
/* eslint-disable import/no-extraneous-dependencies */
import { __ } from '@wordpress/i18n';
/* eslint-enable import/no-extraneous-dependencies */

/**
 * Internal dependencies
 */
import BlockIframePreview from './block-iframe-preview';

const TemplateSelectorPreview = ( { blocks = [], viewportWidth } ) => {
	const noBlocks = ! blocks.length;
	return (
		/* eslint-disable wpcalypso/jsx-classname-namespace */
		<div className={ `template-selector-preview ${ noBlocks ? 'not-selected' : '' }` }>
			{ noBlocks && (
				<div className="editor-styles-wrapper">
					<div className="template-selector-preview__empty-state">
						{ __( 'Select a layout to preview.', 'full-site-editing' ) }
					</div>
				</div>
			) }

			{ /* Always render preview iframe to ensure it's ready to populate with Blocks. */
			/* Without this some browsers will experience a noticavle delay
			/* before Blocks are populated into the iframe. */ }
			<BlockIframePreview blocks={ blocks } viewportWidth={ viewportWidth } />
		</div>
		/* eslint-enable wpcalypso/jsx-classname-namespace */
	);
};

export default TemplateSelectorPreview;
