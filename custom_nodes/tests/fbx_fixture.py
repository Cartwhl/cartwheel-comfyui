"""Original, tiny animated FBX mesh fixtures; no customer or service assets."""
import struct
import zlib

TICKS = 46186158000


def animated_fbx(*, scale=1.0, start=0, duration=2, version=7700, up=1, front=-1, mesh=True, animated=True, compressed=False, distance=200):
    header = '<QQQB' if version >= 7500 else '<IIIB'
    width = struct.calcsize(header)

    def encode(value):
        if isinstance(value, tuple):
            kind, values = value
            data = struct.pack('<' + ('q' if kind == 'l' else kind) * len(values), *values)
            if compressed:data = zlib.compress(data)
            return kind.encode() + struct.pack('<III', len(values), int(compressed), len(data)) + data
        if isinstance(value, str):
            data=value.encode();return b'S' + struct.pack('<I', len(data)) + data
        return b'D' + struct.pack('<d', value) if isinstance(value, float) else b'L' + struct.pack('<q', value)

    def node(name, props, children, offset):
        name=name.encode();data=b''.join(encode(v) for v in props);body=b''
        for child in children:body+=node(*child,offset+width+len(name)+len(data)+len(body))
        if children:body+=bytes(width)
        return struct.pack(header,offset+width+len(name)+len(data)+len(body),len(props),len(data),len(name))+name+data+body

    def p(name, *values):return ('P',[name,name if name.startswith('Lcl ') else 'ColorRGB' if len(values)==3 else 'double','','',*values],[])
    def properties(*items):return ('Properties70',[],list(items))
    globals_={'UnitScaleFactor':float(scale),'UpAxis':up,'UpAxisSign':1,'FrontAxis':2,'FrontAxisSign':front,'CoordAxis':0,'CoordAxisSign':1,'TimeSpanStart':int(start*TICKS),'TimeSpanStop':int((start+duration)*TICKS)}
    objects=[('Model',[10,'Actor\x00\x01Model','Mesh'],[properties(p('Lcl Translation',0.,0.,0.),p('Lcl Rotation',0.,0.,0.),p('Lcl Scaling',1.,1.,1.))]),
             ('Material',[12,'OriginalMaterial\x00\x01Material',''],[('Version',[102],[]),('ShadingModel',['phong'],[]),properties(p('DiffuseColor',.2,.6,.3))])]
    if mesh:objects.append(('Geometry',[11,'Mesh\x00\x01Geometry','Mesh'],[('Vertices',[('d',[-50.,0.,0.,50.,0.,0.,0.,180.,0.])],[]),('PolygonVertexIndex',[('i',[0,1,-3])],[])]))
    connections=[('C',['OO',11,10],[]),('C',['OO',12,10],[]),('C',['OO',10,0],[])]
    if animated:
        objects += [('AnimationStack',[20,'Take\x00\x01AnimStack',''],[properties(p('LocalStart',int(start*TICKS)),p('LocalStop',int((start+duration)*TICKS)))]),
                    ('AnimationLayer',[21,'BaseLayer\x00\x01AnimLayer',''],[]),
                    ('AnimationCurveNode',[22,'T\x00\x01AnimCurveNode',''],[properties(p('d|X',0.),p('d|Y',0.),p('d|Z',0.))]),
                    ('AnimationCurve',[23,'X\x00\x01AnimCurve',''],[('KeyTime',[('l',[int(start*TICKS),int((start+duration)*TICKS)])],[]),('KeyValueFloat',[('f',[0.,float(distance)])],[])])]
        connections += [('C',['OO',21,20],[]),('C',['OO',22,21],[]),('C',['OP',22,10,'Lcl Translation'],[]),('C',['OP',23,22,'d|X'],[])]
    sections=[('FBXHeaderExtension',[],[('FBXHeaderVersion',[1003],[]),('FBXVersion',[version],[])]),('GlobalSettings',[],[properties(*(p(k,v) for k,v in globals_.items()))]),('Objects',[],objects),('Connections',[],connections)]
    result=b'Kaydara FBX Binary  \x00\x1a\x00'+struct.pack('<I',version)
    for section in sections:result+=node(*section,len(result))
    return result+bytes(width)


def scene_fbx(actors=2, *, camera=True, skinned=False, start=0, world_x=0):
    """Independent rigs with repeated names, a static prop and optional camera."""
    def encode(value):
        if isinstance(value,tuple):
            kind,values=value;data=struct.pack('<'+('q' if kind=='l' else kind)*len(values),*values)
            return kind.encode()+struct.pack('<III',len(values),0,len(data))+data
        if isinstance(value,str):
            data=value.encode();return b'S'+struct.pack('<I',len(data))+data
        return b'D'+struct.pack('<d',value) if isinstance(value,float) else b'L'+struct.pack('<q',value)
    def node(name,props,children,offset):
        name=name.encode();data=b''.join(encode(v) for v in props);body=b''
        for child in children:body+=node(*child,offset+25+len(name)+len(data)+len(body))
        if children:body+=bytes(25)
        return struct.pack('<QQQB',offset+25+len(name)+len(data)+len(body),len(props),len(data),len(name))+name+data+body
    def p(name,*v):return ('P',[name,name if name.startswith('Lcl ') else 'double','','',*v],[])
    def props(*v):return ('Properties70',[],list(v))
    def model(i,name,type_,x=0.,y=0.,z=0.):return ('Model',[i,name+'\0\1Model',type_],[props(p('Lcl Translation',x,y,z),p('Lcl Rotation',0.,90. if type_=='Camera' else 0.,0.),p('Lcl Scaling',1.,1.,1.))])
    def link(c,p,role=None):return ('C',['OP' if role else 'OO',c,p,*([role] if role else [])],[])
    def geometry(i):return ('Geometry',[i,'Mesh\0\1Geometry','Mesh'],[('Vertices',[('d',[-50.,0.,0.,50.,0.,0.,0.,180.,0.])],[]),('PolygonVertexIndex',[('i',[0,1,-3])],[])])
    globals_={'UnitScaleFactor':1.,'UpAxis':1,'UpAxisSign':1,'FrontAxis':2,'FrontAxisSign':1,'CoordAxis':0,'CoordAxisSign':1,'TimeSpanStart':int(start*TICKS),'TimeSpanStop':int((start+2)*TICKS)}
    objects=[model(1,'World','Null',float(world_x)),('AnimationStack',[20,'Take\0\1AnimStack',''],[props(p('LocalStart',int(start*TICKS)),p('LocalStop',int((start+2)*TICKS)))]),('AnimationLayer',[21,'Layer\0\1AnimLayer',''],[])]
    links=[link(21,20),link(1,0)]
    identity=[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.]
    for a in range(actors):
        i=100+a*100;objects.extend([model(i,'Character','Null',a*300.),model(i+1,'Mesh','Mesh'),geometry(i+2)])
        links.extend([link(i,1),link(i+1,i),link(i+2,i+1)])
        animated=i+1
        if skinned:
            animated=i+3;matrix=identity.copy();matrix[12]=a*300.
            objects.extend([model(i+3,'Hip','LimbNode'),('Deformer',[i+4,'Skin\0\1Deformer','Skin'],[]),('Deformer',[i+5,'Cluster\0\1Deformer','Cluster'],[('Indexes',[('i',[0,1,2])],[]),('Weights',[('d',[1.,1.,1.])],[]),('TransformLink',[('d',matrix)],[])])])
            links.extend([link(i+3,i),link(i+4,i+2),link(i+5,i+4),link(i+3,i+5)])
        objects.extend([('AnimationCurveNode',[i+10,'T\0\1AnimCurveNode',''],[props(p('d|X',0.),p('d|Y',0.),p('d|Z',0.))]),('AnimationCurve',[i+11,'X\0\1AnimCurve',''],[('KeyTime',[('l',[int(start*TICKS),int((start+2)*TICKS)])],[]),('KeyValueFloat',[('f',[0.,float((a+1)*100)])],[])])])
        links.extend([link(i+10,21),link(i+10,animated,'Lcl Translation'),link(i+11,i+10,'d|X')])
    objects.extend([model(9000,'Prop','Mesh',0.,0.,-500.),geometry(9001)]);links.extend([link(9000,1),link(9001,9000)])
    if camera:
        objects.extend([model(9100,'Camera','Camera',150.,150.,1000.),('NodeAttribute',[9101,'Camera','Camera'],[props(p('AspectWidth',1920.),p('AspectHeight',1080.),p('FieldOfView',40.),p('NearPlane',1.),p('FarPlane',100000.))])]);links.extend([link(9100,1),link(9101,9100)])
    sections=[('GlobalSettings',[],[props(*(p(k,v) for k,v in globals_.items()))]),('Objects',[],objects),('Connections',[],links)]
    data=b'Kaydara FBX Binary  \0\x1a\0'+struct.pack('<I',7700)
    for section in sections:data+=node(*section,len(data))
    return data+bytes(25)
