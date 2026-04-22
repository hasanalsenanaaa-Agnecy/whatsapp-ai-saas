first we will get An incoming message that will initiate the bot

first thing we do: welcome + choose lang (arabic - english). here no AI response, and if they chat we are complete silence and dont send the welcome+lang. they must choose

both lang follow the same order and rules

after lang, we send consent: this convo will be saved for the purpose of making and tracking your order. agree=keep going. disagree=send an apologtic msg that we cant serve them. if they send after rejection, we send the consent msg again and again three times. and then we dont chat with them for four hours if they reject. so we send the consent msgs three times total and if they keep rejecting, we stay silent for four hours. and if they send a msg again after four hours, we restart the convo. no AI allowed here.

if they accept,
Home:
 we welcome to the store and give three options: Menu,track order,customer services, change lang(this is after consent, so when they choose to return to lang, they can change lang and no need to consent again). this is home. here AI is allowed to chat. you cant be at home unless you have accepted the consent. and when ever a client chooses to go home in the next steps, they return here. 

 AI at home must be capable of understanding cotext which we should create an md file for context for this stage. they are going to ask questions about the menu, tracking orders, or CS. for each of these, we have a context of words that the AI should recognize. 

 question related to menu(products): we answer based on facts that we know (we should create an md file about the products of the menu and have them handy with common questions like: do you have this avalible? whats the difference between this date and this date, how much is this date?, do you have deals, etc) and answers must be from the shopify store directly, no hallocinations or making things up. when AI answers, below the answer, there must be a CTA with regards to the question they asked (for example, whats the difference between a and b? AI answers based on facts it pulled from website, and then give them option A and option b to add to cart + home) if they ask further more questions, the same thing happens. 

 if they choose: tracking orders, we must pull that data using their phone number and if we cant find their order from phone number, we ask for their tracking number, and search. 

 if we find the order: we give them what we have found in an appropriate format, and give them options: home - CS. if they go to CS, we ask appropriately what they need? and send that to the owner and send a msg back to them that the CS will contact them and give option to go home. if they keep chatting, send an apologitic msgs and give them the option to go home and complete silence. dont send alert twice to the owner. spams are not allowed.

 if we don't find the order: we say an apologatic msg and we tell them our customer service will contact you and send a msgs to the owner. if they keep msging we send one msg back saying our CS will contact soon, please be patient, and give them the option to go home. if they keep sending msgs talking and never spam owner. only one alert per client to the ownder is allowed evey 4 hours.

 in tracking orders, ai must understand context, what happened to my order? when will my order arrive, etc. this must be included in the lang context for home

 If they choose: CS: we ask their need appropiately, alert owner, and send an apologatic msgs be patient we will help you soon and give option to go home. if they chat, say we will get back to you give home button and slience (no alert to owner this time). AI must understand context here, im having a problem, my order is inccrect, etc. CS lang must be included in the lang context for home. 

 if they choose: menu: we show them show images, show products, home. AI home lang cotext works here too. 

 show images: we show all products, with images, and appropiate descriptions (not too long), weight avaliable, and price. for each a CTA to choose the product and a home button. if they choose a product we ask for quantity:1,2,3,or choose: and these are based on what avalible on websites. if the website says "out" for one product, we never show the product. if customer asks (why this date is not availble, we check, and if its true not avalible we say sorry we are out of stocks for this date.) we must create an md file for this context here. if availble, we show them the product with the ability to choose or go home. 

  when they choose their quanitity and its allowed (not more than the shop says it has), we go to cart, we show the name of product, the weight, and the price, no image. three options: shop more, complete order, or go home. if they go home in this specific situation, cart is emptied and they start over. if they shop more, we show the products in a list with only minimal name to be friendly with whatsapp UIUX no weight, no price and don't repeat the product in the list. when they choose another product from the list, the next question is quantity. then we show the same, shop more, complete order, or go home. AI is allowed to answer questions here based on context of cart. if they press home, you mention that they will lose all whats in their cart, if they accept you go home, if they reject you go back to cart.

 if they choose: show product, we show it in a list just like i mentioned above, minimal wording to be friendly with whatsapp UX. After that they choose quantity and then cart. through the whole proccess AI is allowerd to respond based on context. 

 if they choose home we go home unless they have something in cart we ask if they are sure. AI is allowed to answer based on context.

 if they are in cart, they have three options as mentioned above, add, complete, home. we talked about add, home, now we will talk about complete. if they choose complete, we show the total cart with add, remove, or complete

 for add is the same process as above, for remove, we give a list of the cart and they choose what they want to remove, and if complete we send the link. ai can answer based on context.

 if they complete, we send a summary of name of product, weight, total price, and link in an appropiate formatting.

 if they pay, we check the API and if confimred we send the confirmation, if not yet confirmed we wait the specific time we already set. here AI must be aware of context. questions like, im having a problem, link doesn't work, price is wrong, etc. we alert owner of the specific problem and tell them to be patient and wait. and like always, never spam owner. if they keep msging give them option to go to cart or home.


 for each step we create a context language, common questions for that stage. and for each AI response we give CTA depending on situation. for the least home CTA. 

