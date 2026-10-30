"""Small original animated GLB fixture, with no Cartwheel rig or assets."""
import json
import struct


def animated_glb(x=0, duration=2):
    positions=[[-.25,0,-.15],[.25,0,-.15],[.25,1.8,-.15],[-.25,1.8,-.15],[-.25,0,.15],[.25,0,.15],[.25,1.8,.15],[-.25,1.8,.15]]
    indices=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]
    blob=bytearray();views=[]
    def data(values,fmt):
        while len(blob)%4:blob.append(0)
        offset=len(blob);packed=struct.pack('<'+fmt*len(values),*values);blob.extend(packed)
        views.append({'buffer':0,'byteOffset':offset,'byteLength':len(packed)})
        return len(views)-1
    p=data([v for point in positions for v in point],'f');i=data(indices,'H');t=data([0,duration],'f');a=data([x,0,0,x+.8,0,0],'f')
    while len(blob)%4:blob.append(0)
    doc={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],
         'nodes':[{'name':'IndependentCharacter','mesh':0,'translation':[x,0,0]}],
         'materials':[{'name':'OriginalMaterial','pbrMetallicRoughness':{'baseColorFactor':[.12,.6,.8,1],'metallicFactor':0,'roughnessFactor':.8}}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':1,'material':0}]}],
         'buffers':[{'byteLength':len(blob)}],'bufferViews':views,
         'accessors':[{'bufferView':p,'componentType':5126,'count':8,'type':'VEC3','min':[-.25,0,-.15],'max':[.25,1.8,.15]},
                      {'bufferView':i,'componentType':5123,'count':36,'type':'SCALAR'},
                      {'bufferView':t,'componentType':5126,'count':2,'type':'SCALAR','min':[0],'max':[duration]},
                      {'bufferView':a,'componentType':5126,'count':2,'type':'VEC3'}],
         'animations':[{'name':'Walk','samplers':[{'input':2,'output':3,'interpolation':'LINEAR'}],
                        'channels':[{'sampler':0,'target':{'node':0,'path':'translation'}}]}]}
    raw=json.dumps(doc).encode();raw+=b' '*(-len(raw)%4)
    body=struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(blob),b'BIN\0')+blob
    return struct.pack('<4sII',b'glTF',2,12+len(body))+body


def scene_glb(actors=2, camera=True):
    raw=animated_glb();size=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+size]);binary=raw[28+size:]
    nodes=[{'name':'World','children':[]}];channels=[]
    for a in range(actors):
        group=len(nodes);mesh=group+1;nodes[0]['children'].append(group)
        nodes.extend([{'name':'Character','translation':[a*3,0,0],'children':[mesh]},{'name':'Body','mesh':0}])
        channels.append({'sampler':0,'target':{'node':mesh,'path':'translation'}})
    prop=len(nodes);nodes.append({'name':'Prop','mesh':0,'translation':[0,0,-5]});nodes[0]['children'].append(prop)
    if camera:
        cam=len(nodes);nodes.append({'name':'SceneCamera','camera':0,'translation':[1.5,1.5,10]});nodes[0]['children'].append(cam)
        doc['cameras']=[{'type':'perspective','perspective':{'yfov':.7,'znear':.01,'zfar':1000,'aspectRatio':16/9}}]
    doc['nodes']=nodes;doc['animations'][0]['channels']=channels
    encoded=json.dumps(doc).encode();encoded+=b' '*(-len(encoded)%4)
    body=struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary
    return struct.pack('<4sII',b'glTF',2,12+len(body))+body
