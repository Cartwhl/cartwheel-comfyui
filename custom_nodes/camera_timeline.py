"""Strict, bounded editable camera sequence stored alongside sampled animation."""
import math

DEFAULT_BLEND_FRAMES = 30


def validate_camera_timeline(value, actors, camera_count, world_frame_id, duration, clean_recipe):
    def number(v, label, lo, hi):
        if type(v) not in (float, int) or not math.isfinite(v) or not lo <= v <= hi:
            raise ValueError(f'Invalid camera timeline {label}.')
        return v
    if not isinstance(value, dict) or value.get('schema_version') != 1 or duration is None:
        raise ValueError('Unsupported camera timeline version.')
    if value.get('world_frame_id') != world_frame_id:
        raise ValueError('This camera timeline belongs to another scene.')
    fps = value.get('fps')
    if type(fps) not in (int, float) or fps not in (24, 30, 60, 120):
        raise ValueError('Choose a supported camera timeline frame rate.')
    if abs(number(value.get('duration'), 'duration', 0.000001, 120)-duration)>1e-6:
        raise ValueError('Camera timeline duration must match the motion.')
    segments = value.get('segments')
    if not isinstance(segments, list) or not 1 <= len(segments) <= 64:
        raise ValueError('A scene needs 1–64 camera moves.')
    result = {'schema_version':1,'fps':fps,'duration':duration,'world_frame_id':world_frame_id,'segments':[], 'joins':[]}
    ids=set(); previous=0
    for item in segments:
        if not isinstance(item,dict):raise ValueError('Invalid camera move.')
        identity=item.get('id');name=item.get('name')
        if not isinstance(identity,str) or not 1<=len(identity)<=80 or identity in ids or not isinstance(name,str) or not 1<=len(name)<=120 or any(ord(c)<32 for c in name):raise ValueError('Invalid camera move name or identity.')
        start=number(item.get('start'),'start',0,duration);end=number(item.get('end'),'end',0,duration)
        if start<previous-1e-7 or end-start<min(1/fps,duration)-1e-7:raise ValueError('Camera moves cannot overlap and must last at least one frame.')
        for t in (start,end):
            if abs(t-duration)>1e-7 and abs(t*fps-round(t*fps))>1e-5:raise ValueError('Camera boundaries must snap to frames.')
        a=number(item.get('source_start'),'source start',0,duration);b=number(item.get('source_end'),'source end',0,duration)
        if b<=a:raise ValueError('Camera source interval must be positive.')
        settings=item.get('settings')
        if not isinstance(settings,dict) or settings.get('camera_timeline') is not None:raise ValueError('Camera moves cannot contain nested timelines.')
        clean={'id':identity,'name':f'Camera {len(result["segments"])+1}','start':start,'end':end,'source_start':a,'source_end':b,'settings':clean_recipe(settings,actors,camera_count,world_frame_id,duration)}
        for key in ('ease_start','ease_end'):
            if key in item:
                if type(item[key]) is not bool:raise ValueError('Invalid hold easing option.')
                clean[key]=item[key]
        for key in ('ease_start_frames','ease_end_frames'):
            if key in item:
                frames=number(item[key],'hold transition frames',0,600)
                if type(frames) is not int:raise ValueError('Hold transition length must be whole frames.')
                clean[key]=frames
        if 'animation_range' in item:
            interval=item['animation_range']
            if not isinstance(interval,list) or len(interval)!=2:raise ValueError('Invalid camera animation interval.')
            clean['animation_range']=[number(x,'animation interval',0,duration) for x in interval]
            if interval[1]<=interval[0]:raise ValueError('Camera animation interval must be positive.')
        for key in ('offset_start','offset_end'):
            v=item.get(key,[0,0,0])
            if not isinstance(v,list) or len(v)!=3:raise ValueError('Camera path offsets need XYZ.')
            clean[key]=[number(x,'offset',-100000,100000) for x in v]
        result['segments'].append(clean);ids.add(identity);previous=end
    selected=value.get('selected_id')
    if not isinstance(selected,str) or selected not in ids:raise ValueError('Selected camera is unavailable.')
    result['selected_id']=selected
    result['next_id']=number(value.get('next_id',len(ids)+1),'next camera',1,1000000000)
    if type(result['next_id']) is not int:raise ValueError('Invalid next camera identity.')
    joins=value.get('joins',[])
    if not isinstance(joins,list) or len(joins)>len(segments)-1:raise ValueError('Invalid camera transitions.')
    pairs={(a['id'],b['id']) for a,b in zip(segments,segments[1:])};seen=set()
    for j in joins:
        if not isinstance(j,dict) or not isinstance(j.get('left'),str) or not isinstance(j.get('right'),str) or (j.get('left'),j.get('right')) not in pairs or (j['left'],j['right']) in seen:raise ValueError('Only neighboring cameras can connect.')
        seen.add((j['left'],j['right']))
        clean={k:j[k] for k in ('left','right')}
        for k,default in [('connected',True),('smooth',True),('preserve',False)]:
            v=j.get(k,default)
            if type(v) is not bool:raise ValueError('Invalid camera connection option.')
            clean[k]=v
        if clean['smooth'] and not clean['connected']:raise ValueError('Smooth transitions require connected paths.')
        frames=number(j.get('frames',DEFAULT_BLEND_FRAMES),'transition frames',0,600)
        if type(frames) is not int:raise ValueError('Transition length must be whole frames.')
        clean['frames']=frames;point=j.get('point')
        if point is not None:
            if not isinstance(point,list) or len(point)!=3:raise ValueError('A camera connection needs XYZ.')
            clean['point']=[number(x,'connection',-100000,100000) for x in point]
        else:clean['point']=None
        result['joins'].append(clean)
    return result
