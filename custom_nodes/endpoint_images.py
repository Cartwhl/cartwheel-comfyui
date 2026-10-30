"""Optional provider-selectable endpoint styling using installed Comfy Partner Nodes."""
from comfy_api.latest import io
from comfy_execution.graph_utils import GraphBuilder
from .frame_references import FrameReferences

SERVICES = ['OpenAI GPT Image', 'Google Nano Banana', 'BFL Flux.2']
CONTINUITY_INPUTS = ('style_reference', 'first_frame', 'styled_first_frame', 'references',*[f'reference_{i}' for i in range(1,6)])


def frame_references(image, first_frame=None, styled_first_frame=None, style_reference=None):
    """Keep one numbered image per tensor frame, in the same order for every service."""
    refs, roles = [], []
    for name, batch in [('target', image), ('first', first_frame),
                        ('styled_first', styled_first_frame), ('style', style_reference)]:
        if batch is None:
            continue
        import torch
        if (not isinstance(batch, torch.Tensor) or batch.ndim != 4
                or any(size < 1 for size in batch.shape[:3]) or batch.shape[-1] not in (1, 3, 4)):
            shape = getattr(batch, 'shape', None)
            raise ValueError(f'{name} reference has unsupported image shape {shape}. Expected [batch, height, width, 1/3/4 channels].')
        # Partner nodes can return grayscale or RGBA. Composite alpha onto white
        # so transparent pixels do not become arbitrary black in a reference.
        if batch.shape[-1] == 4:
            alpha = batch[..., 3:4].clamp(0, 1)
            batch = batch[..., :3] * alpha + (1 - alpha)
        elif batch.shape[-1] == 1:
            batch = batch.expand(-1, -1, -1, 3)

        if name != 'style' and batch.shape[0] != 1:
            raise ValueError('Connect a single frame to each camera frame input.')
        for i in range(batch.shape[0]):
            refs.append(batch[i:i + 1])
            roles.append(name)
    return refs, roles


def guided_prompt(prompt, roles):
    lines = [
        'Create ONE styled version of Image 1, the target camera frame.',
        'Image 1 controls the exact camera position, viewing direction, perspective, '
        'crop, composition, performer positions, poses, count and interactions. '
        'Preserve its viewpoint; do not re-stage the scene, swap performer positions, '
        'or borrow a camera angle or pose from another reference.',
    ]
    first = styled = None
    for number, role in enumerate(roles, 1):
        if role == 'first':
            first = number
            lines.append(f'Image {number} is the ORIGINAL FIRST frame: use it only to '
                         'identify the same source performers by their colors, bodies and relationships across frames.')
        elif role == 'styled_first':
            styled = number
            lines.append(f'Image {number} is the STYLED FIRST frame: preserve these exact '
                         'character identities, faces, hair, wardrobe, visual style, lighting and environment '
                         'in the target frame, as viewed from Image 1. Do not copy its camera angle or poses.')
        elif role == 'style':
            lines.append(f'Image {number} is an additional appearance reference; it does not define the camera or poses.')
    if first and styled:
        lines.append(f'Images {first} and {styled} are the before/after pair for the SAME FIRST frame. '
                     'Use that pair to map each source performer to their styled identity, then apply the '
                     'same mapping to Image 1. Keep identities consistent even when bodies or faces turn away.')
    lines.append('Artist instructions (apply appearance changes while preserving the target camera):\n' + prompt.strip())
    return '\n\n'.join(lines)


class CartwheelEndpointImage(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id='CartwheelEndpointImage', display_name='Style Camera Frame · Image Service',
            category='Cartwheel', enable_expand=True, is_api_node=True,
            description='Style the camera reference with up to five optional character/environment images. The shared uploader and automatic first-frame matching are wired in the full workflow. Disabled passes through without paid requests.',
            inputs=[
                io.Image.Input('image', display_name='Camera reference', tooltip='Raw target frame. For last-frame styling, connect the raw LAST frame here; this defines its camera and poses.'),
                io.Boolean.Input('generate', display_name='Generate styled image', default=False),
                io.Combo.Input('service', options=SERVICES, default=SERVICES[0]),
                io.String.Input('prompt', default='Recreate this camera frame in the desired final visual style. Preserve the exact camera viewpoint, framing, performer poses, number of performers and their interactions.', multiline=True),
                io.Int.Input('seed', default=42, min=0, max=2147483647),
                FrameReferences.Input('references',optional=True,lazy=True,display_name='Image references'),
                *[io.Image.Input(f'reference_{i}',display_name=f'Image reference {i}',optional=True,lazy=True) for i in range(1,6)],
                io.Image.Input('style_reference', optional=True, lazy=True),
                io.Image.Input('first_frame', optional=True, lazy=True,
                               tooltip='Original unstyled FIRST frame, paired with styled_first_frame to map source performers to their styled identities.'),
                io.Image.Input('styled_first_frame', optional=True, lazy=True,
                               tooltip='Output of Style first frame. Carries character identity and appearance into the last frame; does not replace its viewpoint.'),
            ], outputs=[io.Image.Output('image')])

    @classmethod
    def check_lazy_status(cls, generate=False, **inputs):
        return [key for key in CONTINUITY_INPUTS if generate and key in inputs and inputs[key] is None]

    @classmethod
    def execute(cls, image, generate=False, service=SERVICES[0], prompt='', seed=42,
                style_reference=None, first_frame=None, styled_first_frame=None, references=None,
                reference_1=None,reference_2=None,reference_3=None,reference_4=None,reference_5=None):
        if not generate:
            return io.NodeOutput(image)
        if service not in SERVICES:
            raise ValueError('Choose a supported image service.')
        if not prompt.strip():
            raise ValueError('Describe the desired image appearance.')
        refs, roles = frame_references(image, first_frame, styled_first_frame, style_reference)
        # Generic user images come immediately after the camera image. Automatic
        # first-frame matching follows them, preserving user reference numbers.
        if references is not None and not isinstance(references,list):raise ValueError('Connect valid frame image references.')
        extra=list(references or [])+[{'image':image,'role':'style'} for image in [reference_1,reference_2,reference_3,reference_4,reference_5] if image is not None]
        if not isinstance(references,(list,type(None))) or any(not isinstance(item,dict) or item.get('role','style') not in {'style','first','styled_first'} for item in extra):raise ValueError('Connect valid frame image references.')
        user_count=roles.count('style');names=[]
        for item in extra:
            role=item.get('role','style')
            normalized,_=frame_references(None,style_reference=item.get('image')) if role=='style' else frame_references(item.get('image'))
            if not normalized:raise ValueError('Image references must contain a valid image.')
            if role=='style':user_count+=len(normalized)
            if user_count>5:raise ValueError('Choose at most five appearance images across uploaded and connected frame references.')
            label=''.join(c for c in str(item.get('name',''))[:200] if c.isprintable())
            if label:names.extend(f'Image {len(refs)+i+1} appearance reference: {label}' for i in range(len(normalized)))
            refs.extend(normalized);roles.extend([role]*len(normalized))
        limit = {'OpenAI GPT Image': 16, 'BFL Flux.2': 8}.get(service)
        if limit and len(refs) > limit:
            raise ValueError(f'{service} accepts at most {limit} images including target and continuity frames. Reduce the style reference batch.')
        prompt = guided_prompt(prompt, roles)+('\n\n'+'\n'.join(names) if names else '')
        graph = GraphBuilder()
        if service == SERVICES[0]:
            values = {'prompt': prompt, 'model': 'gpt-image-2', 'model.quality': 'low',
                      'model.size': 'auto', 'model.custom_width': 1024, 'model.custom_height': 1024,
                      'model.background': 'auto', 'n': 1, 'seed': seed}
            for i, ref in enumerate(refs, 1):
                values[f'model.images.image_{i}'] = ref
            node = graph.node('OpenAIGPTImageNodeV2', **values)
        elif service == SERVICES[1]:
            import torch
            import torch.nn.functional as F
            # Native Gemini accepts a batch with equal spatial dimensions. Include EVERY reference.
            batch = [ref if ref.shape[1:3] == image.shape[1:3] else
                     F.interpolate(ref.movedim(-1, 1), size=image.shape[1:3], mode='bilinear',
                                   align_corners=False).movedim(1, -1) for ref in refs]
            node = graph.node('GeminiImageNode', prompt=prompt, model='gemini-2.5-flash-image',
                              seed=seed, images=torch.cat(batch, dim=0), aspect_ratio='auto',
                              response_modalities='IMAGE')
        else:
            values = {'prompt': prompt, 'model': 'Flux.2 [pro]',
                      'model.width': max(256, min(2048, round(image.shape[2] / 32) * 32)),
                      'model.height': max(256, min(2048, round(image.shape[1] / 32) * 32)), 'seed': seed}
            for i, ref in enumerate(refs, 1):
                values[f'model.images.image_{i}'] = ref
            node = graph.node('Flux2ImageNode', **values)
        return io.NodeOutput(node.out(0), expand=graph.finalize())


class CartwheelEndpointReview(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(node_id='CartwheelEndpointReview',display_name='Review First / Last Images · Optional',category='Cartwheel',is_output_node=True,
            inputs=[io.Boolean.Input('enabled',display_name='Preview endpoint images',default=False),io.Image.Input('first',optional=True,lazy=True),io.Image.Input('last',optional=True,lazy=True),io.Boolean.Input('use_frame_images',display_name='Use start/end frame images for video',default=False)],outputs=[io.Boolean.Output('use_frame_images')])
    @classmethod
    def check_lazy_status(cls,enabled=False,**inputs):return [k for k in ['first','last'] if enabled and k in inputs and inputs[k] is None]
    @classmethod
    def execute(cls,enabled=False,first=None,last=None,use_frame_images=False):
        if not enabled:return io.NodeOutput(bool(use_frame_images))
        from comfy_api.latest import ui
        # Separate previews support distinct resolutions from different services.
        first_ui=ui.PreviewImage(first).as_dict() if first is not None else {}
        last_ui=ui.PreviewImage(last).as_dict() if last is not None else {}
        return io.NodeOutput(bool(use_frame_images),ui={'images':first_ui.get('images',[])+last_ui.get('images',[])})
